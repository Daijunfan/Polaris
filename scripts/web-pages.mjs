import { load } from 'cheerio'

const clean = value => String(value || '').replace(/\u00a0/g, ' ').replace(/[\t \r]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
export function pageDocument(html) {
  const $ = load(html)
  $('script,style,noscript,template,[hidden],[aria-hidden="true"]').remove()
  $('[style]').each((_, element) => { if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(element).attr('style'))) $(element).remove() })
  $('br').replaceWith('\n')
  $('p,li,tr,h1,h2,h3,h4').prepend('\n').append('\n')
  return $
}

export function parseOfficialProfile(html, url) {
  const $ = pageDocument(html), text = selector => clean($(selector).text())
  const name = text('#teacherName')
  if (!name || !/学院|研究院|中心|学?部/.test(text('#collegeName'))) throw new Error('页面不是可识别的北邮导师介绍')
  const sections = $('.teac-rightcon .teac-bkcon').map((_, element) => ({
    id: $(element).attr('id') || '',
    title: clean($(element).find('.btwz .fontColor').first().text()),
    text: clean($(element).find('.info2').text()),
  })).get().filter(section => section.title && section.text)
  const uniqueBlocks = list => {
    const seen = new Set()
    return list.filter(item => {
      const value = item?.trim()
      if (!value || seen.has(value)) return false
      seen.add(value)
      return true
    }).join('\n') || null
  }
  const section = (pattern, excludeIds = []) => sections.filter(item => !excludeIds.includes(item.id) && pattern.test(item.title)).map(item => `${item.title}：${item.text}`).join('\n') || null
  const contact = text('#LXFS'), email = contact.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] || null
  return {
    name, college: [...new Set(text('#collegeName').replace(/^所属院系[：:]\s*/, '').split(/[、,，]+/).map(s => s.trim()).filter(Boolean))].join('、'),
    professional_title: text('#technicalTitle') || null,
    supervisor_type: text('.mentorType').replace(/^导师类别[：:]\s*/, '') || null,
    programs: text('#specialtyName').replace(/^所属专业[：:]\s*/, '') || null,
    contact_email: email,
    research_areas: text('#researchDirection') || null,
    biography: text('#GRJJ .info2') || null,
    team_description: text('#TDZS .info2') || null,
    projects: uniqueBlocks([text('#XMQK .info2'), text('#KYXM .info2'), section(/项目|课题/, ['XMQK', 'KYXM'])]),
    achievements: uniqueBlocks([text('#YJCG .info2'), section(/成果|论文|著作|奖励|获奖|专利|学术任职|学术服务/, ['YJCG'])]),
    teaching: section(/教学|课程|教育|工作经历/) || null,
    admissions: section(/招生|指导学科/) || null,
    page_title: `${name} · 北京邮电大学导师主页`, url,
  }
}

export function parseSupplement(html, seed) {
  const $ = pageDocument(html), main = $(seed.selector)
  if (!main.length) throw new Error('未找到配置的正文区域')
  const text = clean(main.text())
  const host=new URL(seed.url).hostname,official=seed.source_type==='学校官网'&&(host==='bupt.edu.cn'||host.endsWith('.bupt.edu.cn'))
  const named=text.includes(seed.name)||official&&clean($('title').text()+' '+$('h1').text()).includes(seed.name)
  if (!named || !official&&!/北京邮电大学|北邮/.test(text)) throw new Error('正文未同时确认导师姓名和北邮身份')
  // Third-party pages contribute a short, relevant excerpt rather than a complete article mirror.
  const lines = text.split(seed.profile?'\n':/(?<=[。！？])\s*|\n/).map(clean).filter(Boolean)
  const selected = lines.flatMap((line, index) => line.includes(seed.name) || seed.profile && /研究方向|研究领域|主要研究(?!成果|项目)|主要从事/.test(line) ? [line, ...(/^(?:研究方向|研究领域|主要研究方向)[：:]?$/.test(line) ? lines.slice(index + 1, index + 2) : [])] : [])
  const excerpt = [...new Set(selected)].join('\n') || text, limit=seed.max_chars||450
  const biography = excerpt.length>limit?(excerpt.slice(0,limit).replace(/[^\n。；！？]*$/,'')||excerpt.slice(0,limit)):excerpt
  const heading=seed.profile?lines.findIndex(line=>/^(?:主要)?研究(?:方向|领域)[：:]?$/.test(line)):-1
  const research_areas=heading>=0?lines[heading+1]||null:biography.match(/(?:主要)?研究(?:方向|领域)(?:是|为|[：:])\s*([^。\n]+)/)?.[1]||null
  return { name: seed.name, college: seed.college || '网络空间安全学院', page_title: seed.title || clean($('h1').first().text()) || clean($('title').text()), biography, research_areas, url: seed.url, published_at: seed.published_at || null }
}
