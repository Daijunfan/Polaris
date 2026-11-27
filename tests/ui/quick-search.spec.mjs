import {test,expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const ranking='把多个学院的老师放一起，来个你认为最好的导师的排名。只前30个最好的导师就够了。'

test.afterEach(async({request})=>{
  const state=await request.get('/api/workbench')
  if(!state.ok())return
  const {items=[]}=await state.json()
  for(const item of items)await request.delete('/api/workbench/items/'+encodeURIComponent(item.key))
})

const audit=async page=>{
  await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))))
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()
  expect(result.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))).toEqual([])
}

test('快捷键 Ctrl+K 与顶栏按钮打开速查导师，支持同音姓、方向过滤、方向键与 Enter 直达档案且通过无障碍检查',async({page})=>{
  const nav=page.getByRole('navigation',{name:'核心功能'})
  await page.goto('/')
  await nav.getByRole('button',{name:'查看导师',exact:true}).click()
  const quick=page.getByRole('region',{name:'查看导师',exact:true})
  await expect(quick).toBeVisible()
  await audit(page)

  const input=quick.getByRole('textbox',{name:'搜索导师姓名、方向或关键词'})
  await input.fill('傅俊松')
  await expect(quick.locator('.quick-search-list')).toContainText('付俊松')

  await quick.getByRole('button',{name:'清空搜索词',exact:true}).click()
  await quick.getByRole('button',{name:'6G',exact:true}).click()
  await expect(quick.locator('.quick-search-meta')).toContainText(/共 \d+ 位匹配/)
  await expect(quick.locator('.quick-search-list .qs-item').first()).toBeVisible()

  await input.press('ArrowDown')
  await input.press('Enter')
  const dossier=page.getByRole('dialog',{name:'导师档案',exact:true})
  await expect(dossier).toBeVisible()
  await expect(dossier.getByRole('button',{name:'返回查看导师',exact:true})).toBeVisible()
  await expect(dossier.getByRole('button',{name:'上一位导师',exact:true})).toBeVisible()
  await expect(dossier.getByRole('button',{name:'下一位导师',exact:true})).toBeVisible()
  const dossierName=dossier.locator('.dossier-hero h3').first()
  const firstName=await dossierName.innerText()
  await dossier.getByRole('button',{name:'下一位导师',exact:true}).click()
  await expect(dossierName).not.toHaveText(firstName)
  await expect(dossier).toBeVisible()

  await dossier.getByRole('button',{name:'返回查看导师',exact:true}).click()
  await expect(dossier).toHaveCount(0)
  await expect(quick).toBeVisible()
  await expect(quick.getByRole('button',{name:'6G',exact:true})).toHaveAttribute('aria-pressed','true')

  await quick.locator('.quick-search-list .qs-item-main').first().click()
  await expect(dossier).toBeVisible()
  await dossier.getByRole('button',{name:'关闭面板',exact:true}).click()
  await expect(dossier).toHaveCount(0)
  await expect(quick).toBeVisible()
  await expect(quick.getByRole('button',{name:'6G',exact:true})).toHaveAttribute('aria-pressed','true')

  await nav.getByRole('button',{name:'Agent 交互',exact:true}).click()
  await expect(quick).toBeHidden()

  await page.setViewportSize({width:390,height:844})
  await page.keyboard.press('Control+k')
  const mobileQuick=page.getByRole('region',{name:'查看导师',exact:true})
  await expect(mobileQuick).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await audit(page)
})

test('推荐追问的全部收入候选库动作直接生效，无需额外模型轮次',async({page})=>{
  await page.goto('/')
  await page.getByRole('textbox',{name:'向北极星提问'}).fill(ranking)
  await page.getByRole('button',{name:'发送问题'}).click()
  await expect(page.getByRole('button',{name:'复制回答'})).toBeVisible({timeout:15000})

  const followUps=page.locator('.answer-followups')
  const saveAll=followUps.getByRole('button',{name:'全部收入候选库',exact:true})
  await expect(saveAll).toBeVisible({timeout:15000})
  await saveAll.click()

  await expect(page.getByRole('region',{name:'候选库',exact:true})).toBeVisible({timeout:15000})
  await expect(page.getByRole('heading',{name:'我的导师候选',exact:true})).toBeVisible()
  await expect.poll(()=>page.locator('.mentor-tile').count()).toBeGreaterThanOrEqual(2)
})

test('速查导师支持多维度多选 filter 叠加、学院多选、单项移除与一键清空且无障碍达标',async({page})=>{
  const nav=page.getByRole('navigation',{name:'核心功能'})
  await page.goto('/')
  // 首页输入框下方的「查看导师」入口卡片同样能打开查看导师页。
  await page.getByRole('region',{name:'导师与候选入口'}).getByRole('button',{name:/查看导师/}).click()
  await expect(page.getByRole('region',{name:'查看导师',exact:true})).toBeVisible()
  await nav.getByRole('button',{name:'Agent 交互',exact:true}).click()
  await expect(page.getByRole('region',{name:'查看导师',exact:true})).toBeHidden()
  await nav.getByRole('button',{name:'查看导师',exact:true}).click()
  const quick=page.getByRole('region',{name:'查看导师',exact:true})
  await expect(quick).toBeVisible()
  await expect(quick.getByRole('button',{name:/加入对比/})).toHaveCount(0)

  const activeBar=quick.locator('.qs-active-bar')
  const meta=quick.locator('.quick-search-meta')
  const matchCount=async()=>{
    const text=await meta.innerText()
    const matched=text.match(/共\s*(\d+)\s*位匹配/)
    return matched?Number(matched[1]):null
  }

  const intern=quick.getByRole('button',{name:'可以实习',exact:true})
  const noClock=quick.getByRole('button',{name:'不打卡',exact:true})
  const phd=quick.getByRole('button',{name:'博导',exact:true})
  const colleges=quick.getByRole('group',{name:'所属学院筛选'})
  const cyber=colleges.getByRole('button',{name:'网络空间安全',exact:true})
  const computer=colleges.getByRole('button',{name:'计算机',exact:true})

  await expect(activeBar).toBeHidden()

  // 多维 filter 同时叠加，互不覆盖
  await intern.click()
  await expect(intern).toHaveAttribute('aria-pressed','true')
  await expect(activeBar).toContainText('已选 1 项筛选')
  await expect(meta).toContainText(/共 \d+ 位匹配/)
  const oneFilter=await matchCount()

  await noClock.click()
  await expect(noClock).toHaveAttribute('aria-pressed','true')
  await expect(intern).toHaveAttribute('aria-pressed','true')
  await expect(activeBar).toContainText('已选 2 项筛选')
  const twoFilters=await matchCount()

  await phd.click()
  await expect(phd).toHaveAttribute('aria-pressed','true')
  await expect(intern).toHaveAttribute('aria-pressed','true')
  await expect(noClock).toHaveAttribute('aria-pressed','true')
  await expect(activeBar).toContainText('已选 3 项筛选')
  const threeFilters=await matchCount()

  expect(threeFilters).toBeGreaterThan(0)
  expect(twoFilters).toBeGreaterThan(threeFilters)
  expect(oneFilter).toBeGreaterThan(twoFilters)

  // 搜索词与多选 filter 独立叠加，清空搜索词后 filter 不丢失
  const input=quick.getByRole('textbox',{name:'搜索导师姓名、方向或关键词'})
  await input.fill('安全')
  await expect(input).toHaveValue('安全')
  await expect(quick.getByRole('button',{name:'清空搜索词',exact:true})).toBeVisible()
  expect(await matchCount()).toBeLessThanOrEqual(threeFilters)

  await input.fill('')
  await expect(input).toHaveValue('')
  await expect(activeBar).toContainText('已选 3 项筛选')
  await expect(intern).toHaveAttribute('aria-pressed','true')
  await expect(noClock).toHaveAttribute('aria-pressed','true')
  await expect(phd).toHaveAttribute('aria-pressed','true')
  await expect.poll(matchCount).toBe(threeFilters)

  // 学院多选：先展开所属学院托盘
  await quick.getByRole('button',{name:/^所属学院/}).click()
  await expect(colleges).toBeVisible()
  await cyber.click()
  await expect(cyber).toHaveAttribute('aria-pressed','true')
  await expect(activeBar).toContainText('已选 4 项筛选')
  const oneCollege=await matchCount()

  await computer.click()
  await expect(computer).toHaveAttribute('aria-pressed','true')
  await expect(cyber).toHaveAttribute('aria-pressed','true')
  await expect(activeBar).toContainText('已选 5 项筛选')
  const twoColleges=await matchCount()
  expect(twoColleges).toBeGreaterThanOrEqual(oneCollege)

  // 单项移除，其余条件保持不变
  await quick.getByRole('button',{name:'移除筛选：不打卡',exact:true}).click()
  await expect(noClock).toHaveAttribute('aria-pressed','false')
  await expect(intern).toHaveAttribute('aria-pressed','true')
  await expect(phd).toHaveAttribute('aria-pressed','true')
  await expect(activeBar).toContainText('已选 4 项筛选')

  // 一键清空
  await quick.getByRole('button',{name:'清空筛选',exact:true}).click()
  await expect(activeBar).toBeHidden()
  for(const button of [intern,noClock,phd,cyber,computer])await expect(button).toHaveAttribute('aria-pressed','false')

  // 方向多选并在同时满足与任一方向之间切换
  const largeModel=quick.getByRole('button',{name:'大模型',exact:true})
  const sixG=quick.getByRole('button',{name:'6G',exact:true})
  await largeModel.click()
  await expect(largeModel).toHaveAttribute('aria-pressed','true')
  await expect(activeBar).toContainText('已选 1 项筛选')
  await sixG.click()
  await expect(sixG).toHaveAttribute('aria-pressed','true')
  await expect(largeModel).toHaveAttribute('aria-pressed','true')
  await expect(activeBar).toContainText('已选 2 项筛选')

  const directionToggle=quick.getByRole('button',{name:/方向匹配：/})
  await expect(directionToggle).toBeVisible()
  await expect(directionToggle).toContainText('同时满足')
  await expect(meta).toContainText(/共 \d+ 位匹配/)
  const bothDirections=await matchCount()

  await directionToggle.click()
  await expect(directionToggle).toContainText('任一方向')
  await expect.poll(matchCount,{timeout:10000}).toBeGreaterThan(150)
  if(bothDirections!==null)expect(await matchCount()).toBeGreaterThanOrEqual(bothDirections)

  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await audit(page)

  await page.setViewportSize({width:390,height:844})
  await expect(quick).toBeVisible()
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await audit(page)
})

test('导师档案采用紧凑 Bento 双栏排版：崔哲与付俊松档案左右等高无大面积留白且通过无障碍检查',async({page})=>{
  await page.goto('/')
  await page.getByRole('navigation',{name:'核心功能'}).getByRole('button',{name:'查看导师',exact:true}).click()
  const quick=page.getByRole('region',{name:'查看导师',exact:true})
  await expect(quick).toBeVisible()

  const input=quick.getByRole('textbox',{name:'搜索导师姓名、方向或关键词'})
  await input.fill('崔哲')
  await expect(quick.locator('.quick-search-list')).toContainText('崔哲')
  await quick.locator('.quick-search-list .qs-item-main').filter({hasText:'崔哲'}).first().click()

  const dossier=page.getByRole('dialog',{name:'导师档案',exact:true})
  await expect(dossier).toBeVisible()
  const hero=dossier.locator('.dossier-hero')
  await expect(hero.locator('.dossier-identity h3').first()).toHaveText('崔哲')

  // 首屏英雄区直接给出候选库动作、邮箱与研究方向的联系方式，无需展开折叠区。
  await expect(hero.getByRole('button',{name:/^(加入候选库|已在候选库)$/})).toBeVisible()
  const email=hero.getByRole('link',{name:'cuizhe@bupt.edu.cn',exact:true})
  await expect(email).toBeVisible()
  await expect(email).toHaveAttribute('href','mailto:cuizhe@bupt.edu.cn')
  await expect(hero.locator('.dossier-dir-tag').filter({hasText:'人工智能与大数据'})).toBeVisible()

  // 双栏 Bento：左侧培养画像与右侧卡片区必须视觉等高，杜绝左高右空的大面积留白。
  const grid=dossier.locator('.dossier-grid')
  await expect(grid).toBeVisible()
  const radar=grid.locator('.dossier-radar')
  const rightCol=grid.locator('.dossier-right-col')
  await expect(radar).toBeVisible()
  await expect(rightCol).toBeVisible()
  await expect.poll(async()=>{
    const [leftBox,rightBox]=await Promise.all([radar.boundingBox(),rightCol.boundingBox()])
    if(!leftBox||!rightBox)return Infinity
    return Math.abs(leftBox.height-rightBox.height)
  },{message:'左侧培养画像与右侧 Bento 栏高度差应不超过 12px'}).toBeLessThanOrEqual(12)

  // 右栏必须承载招生/学科或档案核验内容，而不是空白占位。
  const rightCard=rightCol.locator('.dossier-bento-card').first()
  await expect(rightCard).toBeVisible()
  await expect(rightCard).toContainText(/指导学科与招生|档案核验/)

  await audit(page)
})
