"""Import new PDF material; preserve the current edited review collection."""
import hashlib
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
PLAINTEXT_DIR = ROOT / '.local' / 'plaintext-data'
TARGET = PLAINTEXT_DIR / 'pdf-reviews.json'
DOCUMENTS = [
    ('计算机导师.pdf', '计算机学院', '计算机', 2),
    ('软件工程导师.pdf', '软件学院', '软件', 1),
    ('人工智能导师.pdf', '人工智能学院', '人工智能', 0),
]
NAME = r'[\u4e00-\u9fff]{2,4}'
NAMES = NAME + r'(?:、' + NAME + r')*'
SCORED = re.compile(r'^(' + NAMES + r')\s*([1-5])(?=$|[,，(（]|\s*(?:学生|只带))')
GROUP = re.compile(r'^([一二三四五六七八九十]+)组(?=$|[（(：:])')
CHINESE = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6,
           '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12,
           '十三': 13, '十四': 14, '十五': 15, '十六': 16, '十七': 17}


def identifier(kind, value):
    return f'{kind}-{hashlib.sha256(value.encode()).hexdigest()[:12]}'


def compact(value):
    return re.sub(r'\s+', '', value or '')


def cell_text(page, rect):
    if not rect:
        return ''
    blocks = page.get_text('dict', clip=rect)['blocks']
    return ''.join(''.join(span['text'] for span in line['spans']).strip()
                   for block in blocks for line in block.get('lines', []))


def pick_fields(text):
    # Join wrapped lines while preserving source paragraphs and labelled answers.
    paragraphs = re.split(r'\n\s*\n', text)
    lines = []
    for paragraph in paragraphs:
        current = ''
        for line in paragraph.splitlines():
            line = line.strip()
            labelled = re.match(r'^[^：:。；]{2,32}[：:]', line)
            if current and labelled:
                lines.append(current)
                current = line
            else:
                current += line
        if current:
            lines.append(current)
    select = lambda pattern: '\n'.join(line for line in lines if re.search(pattern, line)) or None
    directions = []
    for line in lines:
        match = re.search(r'研究方向(?:(?:有哪些)?[：:]|是|为|包括)\s*(.+)', line)
        if match:
            directions.append(re.split(r'[；。]', match[1])[0].strip())
    stipend = select(r'补助|工资|劳务|津贴')
    monthly = []
    for line in lines:
        if not re.search(r'补助|工资|劳务|津贴', line):
            continue
        for clause in re.split(r'[；;。]', line):
            if '国家补助' in clause or not re.search(r'每(?:个)?月|/月|一个月', clause):
                continue
            amount = re.search(r'(?<!\d)(\d+(?:\.\d+)?)\s*(?:[-~～—至]\s*(\d+(?:\.\d+)?))?\s*([kK千])?', clause)
            if amount:
                multiplier = 1000 if amount[3] else 1
                low = float(amount[1]) * (multiplier if not amount[2] else 1)
                high = float(amount[2] or amount[1]) * multiplier
                monthly.extend([low, high])
    return dict(personal_directions='；'.join(dict.fromkeys(directions)) or None,
                management=select(r'管理|打卡|坐班|考勤|工作时间|上班时间|出勤|放养|放羊'),
                internship=select(r'实习'), graduation=select(r'论文|毕业|SCI|专利'),
                stipend_text=stipend,
                stipend_monthly_min=min(monthly) if monthly else None,
                stipend_monthly_max=max(monthly) if monthly else None)


def applicable_context(text, name, names):
    parts = re.split(r'(?<=[。；;])|\n', text)
    return '\n'.join(part.strip() for part in parts if part.strip() and
                     (name in part or re.search(r'除|其余|其他老师', part) or
                      not any(other in part for other in names)))


def import_document(filename, college, prefix, table_pages, source_id):
    path = ROOT / 'PDFs' / filename
    original = path.read_bytes()
    # These supplied PDFs contain unrelated bytes after their final PDF trailer.
    # Limit the reader to the complete PDF; keep the original files byte-for-byte.
    end = original.rfind(b'%%EOF')
    if end < 0:
        raise ValueError(f'{filename}: missing PDF trailer')
    document = pymupdf.open(stream=original[:end + 5], filetype='pdf')
    pages = [page.get_text('text', sort=True) for page in document]
    if any(len(page.strip()) < 30 for page in pages):
        raise ValueError(f'{filename}: unreadable page')
    rows = []
    for page_number, page in enumerate(pages, 1):
        lines = page.splitlines()
        while lines and not lines[-1].strip():
            lines.pop()
        if lines and lines[-1].strip() == str(page_number):
            lines.pop()
        rows.extend((page_number, line.strip()) for line in lines)
        rows.append((page_number, ''))

    mentors, reviews, group_texts = {}, [], {}

    def mentor(name):
        if name not in mentors:
            mentors[name] = dict(mentor_id=identifier('mentor', college + ':' + name),
                name=name, college=college, group=None, directions='', personal_directions=None,
                rating=None, stipend_monthly_min=None, stipend_monthly_max=None, stipend_text=None,
                management=None, internship=None, graduation=None, review_text=None, review_note=None,
                group_context=None, mentor_note=None, student_count=None, exam_count=None,
                recommended_count=None, exam_ratio=None, recommended_ratio=None,
                score_first_min=None, score_first_mean=None, score_first_median=None,
                score_first_max=None, source_ids=[source_id])
        return mentors[name]

    def review(name, group, rating, text, start, finish, scope='personal'):
        item = mentor(name) if name else None
        reviews.append(dict(review_id=identifier('review', f'{source_id}:{name}:{start}:{len(reviews)}'),
            mentor_id=item['mentor_id'] if item else None, name=name or group, college=college,
            group=group, rating=rating, text=text, stipend_text=pick_fields(text)['stipend_text'],
            source_ids=[source_id], source_locator=f'PDFs/{filename}:P{start}-{finish}',
            note='共同评价' if scope == 'shared' else None))

    # Use each actual cell rectangle to retain the order of names and punctuation.
    for page in list(document)[:table_pages]:
        for table in page.find_tables().tables:
            for row in table.rows:
                values = [cell_text(page, rect) for rect in row.cells]
                if len(values) < 4 or not re.search(r'\d+组', compact(values[1])):
                    continue
                number = int(re.search(r'(\d+)组', compact(values[1]))[1])
                group = f'{prefix} {number} 组'
                for label in compact(values[3]).split('、'):
                    name = re.split(r'[（(]', label)[0]
                    if not re.fullmatch(NAME, name):
                        raise ValueError(f'{filename}: invalid catalogue name {label}')
                    item = mentor(name)
                    item['group'] = group
                    item['directions'] = values[2]
                    restriction = re.search(r'[（(](.*?)[）)]', label)
                    if restriction:
                        item['mentor_note'] = '招生目录：' + restriction[1]

    boundaries = []
    if table_pages:
        for i, (page, line) in enumerate(rows):
            if page <= table_pages:
                continue
            group = GROUP.match(line)
            if group:
                boundaries.append((i, 'group', f'{prefix} {CHINESE[group[1]]} 组', None))
                continue
            scored = SCORED.match(line)
            if scored:
                boundaries.append((i, 'person', scored[1], int(scored[2])))
            elif line.startswith('导师姓名：'):
                next_index = next((j for j in range(i + 1, len(rows)) if rows[j][1]), None)
                if next_index is None or not re.match(r'^打分[：:]\s*[1-5]', rows[next_index][1]):
                    raise ValueError(f'{filename}: missing score after {line}')
                score = int(re.search(r'[1-5]', rows[next_index][1])[0])
                boundaries.append((i, 'person', line.split('：', 1)[1], score))
    else:
        # Personal entries in the AI document have a name followed by a score line.
        for i, (_, line) in enumerate(rows):
            if not re.fullmatch(NAME, line):
                continue
            j = next((j for j in range(i + 1, len(rows)) if rows[j][1]), None)
            if j is not None and re.match(r'^打分[：:]\s*[1-5]', rows[j][1]):
                boundaries.append((i, 'person', line, int(re.search(r'[1-5]', rows[j][1])[0])))
        # Keep laboratory-wide ratings attached only to their explicitly listed teachers.
        labs = [('模式识别实验室', '导师包括：', 5),
                ('智能媒体与文化计算教研中心', '导师包括：', 5),
                ('脑认知与智能医学实验室，刘勇组', '这个实验室的以下老师不推荐：', 1)]
        for label, marker, rating in labs:
            start = next(i for i, (_, line) in enumerate(rows) if line == label)
            stops = [i for i, (_, line) in enumerate(rows) if i > start and
                     (line in [lab[0] for lab in labs] or re.match(r'^[二三四]、', line))]
            finish = min(stops, default=len(rows))
            text = '\n'.join(line for _, line in rows[start:finish]).strip()
            group_texts[label.split('，')[0]] = text
            after = text.split(marker, 1)[1].lstrip()
            names = []
            for line in after.splitlines():
                line = compact(line)
                if line and re.fullmatch(r'[\u4e00-\u9fff、，]+', line):
                    names.extend(re.findall(NAME, line.replace('、', ' ')))
                else:
                    break
            for name in names:
                item = mentor(name);item['group'] = label.split('，')[0]
                review(name, item['group'], rating, text, rows[start][0], rows[finish-1][0], 'shared')
            if rating == 1:
                positive = re.search(r'([\u4e00-\u9fff、]+)老师都不错', text)
                if positive:
                    for name in positive[1].split('、'):
                        item = mentor(name);item['group'] = label.split('，')[0]
                        review(name, item['group'], None, positive[0], rows[start][0], rows[finish-1][0])

    group = None
    for n, (start, kind, label, rating) in enumerate(boundaries):
        finish = boundaries[n+1][0] if n+1 < len(boundaries) else len(rows)
        body = '\n'.join(line for _, line in rows[start:finish]).strip()
        # AI section headings and the laboratory block are not part of the previous person.
        body = re.split(r'\n[三四]、', body)[0].strip()
        if kind == 'group':
            group = label;group_texts[group] = body
            review(None, group, None, body, rows[start][0], rows[finish-1][0])
            listed = re.search(r'^导师[：:]\s*(.+(?:\n[\u4e00-\u9fff、（）]+)*)', body, re.M)
            if listed:
                for name in compact(listed[1]).split('、'):
                    name = re.split(r'[（(]', name)[0]
                    if re.fullmatch(NAME, name):
                        item = mentor(name)
                        if not item['group']:
                            item['group'] = group
            continue
        for name in label.split('、'):
            item = mentor(name)
            if not item['group']:
                item['group'] = group
            review(name, group, rating, body, rows[start][0], rows[finish-1][0], 'shared' if '、' in label else 'personal')

    by_mentor = defaultdict(list)
    for record in reviews:
        if record['mentor_id']:
            by_mentor[record['mentor_id']].append(record)
    for item in mentors.values():
        records = by_mentor[item['mentor_id']]
        personal = [record for record in records if record['note'] != '共同评价']
        chosen = personal or records
        ratings = {record['rating'] for record in chosen if record['rating'] is not None}
        item['rating'] = next(iter(ratings)) if len(ratings) == 1 else None
        item['review_text'] = '\n\n'.join(record['text'] for record in records) or None
        item.update(pick_fields('\n\n'.join(record['text'] for record in chosen)))
        if len(ratings) > 1:
            item['review_note'] = '；'.join(f'{record["group"]}评价{record["rating"]}分' for record in chosen if record['rating'] is not None)
        elif records and not personal:
            item['review_note'] = '共同评价'
        applicable = list(dict.fromkeys(record['group'] for record in personal if record['group'])) or [item['group']]
        item['group_context'] = '\n\n'.join(applicable_context(group_texts[g], item['name'], mentors)
                                            for g in applicable if g in group_texts) or None
        if not item['directions'] and item['group_context']:
            direction = re.search(r'^方向[：:]\s*(.+)', item['group_context'], re.M)
            item['directions'] = direction[1] if direction else ''
    year = int(re.search(r'20\d{2}', pages[0])[0])
    source = dict(id=source_id, title=f'{year} {college}导师评价', kind='第三方评价', year=year,
                  scope=college, file=f'PDFs/{filename}', pages=len(document),
                  sha256=hashlib.sha256(original).hexdigest())
    return dict(source=source, mentors=list(mentors.values()), reviews=reviews,
                pages=[dict(page=i+1, text=text) for i, text in enumerate(pages)])


def load_dataset(name, default=None):
    plaintext = PLAINTEXT_DIR / f'{name}.json'
    if plaintext.exists():
        return json.loads(plaintext.read_text(encoding='utf-8'))
    vault = ROOT / 'data' / f'{name}.vault'
    if vault.exists():
        raw = subprocess.check_output(
            [
                'node',
                '--input-type=module',
                '-e',
                "import { readSealedDataset } from './lib/data.js'; process.stdout.write(JSON.stringify(readSealedDataset(process.argv[1]) ?? null));",
                name,
            ],
            cwd=str(ROOT),
            encoding='utf-8',
        )
        parsed = json.loads(raw)
        if parsed is not None:
            return parsed
    return {} if default is None else default


def main():
    old = load_dataset('pdf-reviews', {'sources': []})
    used = []
    for name in ['dataset', 'web-profiles', 'mentor-notes']:
        used.extend(load_dataset(name, {}).get('sources', []))
    next_source = max(int(source['id'][1:]) for source in used + old['sources']) + 1
    previous = {source.get('original_file', source['file']): source['id'] for source in old['sources']}
    result = dict(version=1, sources=[], mentors=[], reviews=[], documents=[])
    for filename, college, prefix, table_pages in DOCUMENTS:
        source_id = previous.get('PDFs/' + filename)
        if not source_id:
            source_id = f'S{next_source}';next_source += 1
        imported = import_document(filename, college, prefix, table_pages, source_id)
        result['sources'].append(imported['source'])
        result['mentors'].extend(imported['mentors']);result['reviews'].extend(imported['reviews'])
        result['documents'].append(dict(source_id=source_id, pages=imported['pages']))
    target = ROOT / '.local/pdf-import/pending.json' if old.get('review_revision') else TARGET
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if target == TARGET and '--no-seal' not in sys.argv:
        cmd = ['node', 'scripts/seal-data.mjs', '--only', 'pdf-reviews']
        if '--custom' in sys.argv:
            cmd.append('--custom')
        subprocess.run(cmd, cwd=str(ROOT), check=True)
    print(f'Imported material: {target}')
    print(json.dumps({college:dict(mentors=sum(m['college']==college for m in result['mentors']),
                                  rated=sum(m['college']==college and m['rating'] is not None for m in result['mentors']),
                                  reviews=sum(r['college']==college for r in result['reviews']))
                      for _,college,_,_ in DOCUMENTS}, ensure_ascii=False))


if __name__ == '__main__':
    main()
