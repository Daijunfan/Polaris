import {test,expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// 多标签导师的端到端不截断契约：画像栏、速查、候选卡片与导师档案都必须完整展示全部标签。
const profile={
  stage:'exam',
  goal:'career',
  score:365,
  musts:['internship','no_clock','stipend','personal','no_paper','kind'],
  interests:'漏洞挖掘',
}
const profileChips=['统考','365分','毕业就业','能实习','不打卡','补助高','亲自指导','不卡论文','尊重学生','漏洞挖掘']
const goodFlags=['可以实习','不打卡','时间自由','不卡论文','亲自指导','尊重学生','经费充足','补助 ¥2000/月']

test.afterEach(async({request})=>{
  await request.delete('/api/profile')
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

test('多标签导师在画像栏、速查、候选卡片与导师档案完整展示且无 +N 截断',async({page,request})=>{
  await request.put('/api/profile',{data:profile})
  const mentors=await Promise.all(['付俊松','南国顺'].map(async name=>(await (await request.get('/api/workbench/directory?q='+encodeURIComponent(name))).json()).rows[0]))
  await request.post('/api/workbench/items',{data:{mentors}})

  // 画像栏：超过 8 个标签项仍全部展示在输入框上方，不折叠成 +N。
  await page.goto('/')
  await expect(page.getByRole('heading',{name:'选导师，先看清'})).toBeVisible()
  await expect(page.getByRole('textbox',{name:'向北极星提问'})).toBeVisible()
  const pillChips=page.locator('.profile-pill-chips')
  await expect(pillChips).toBeVisible()
  await expect(pillChips.locator('i')).toHaveText(profileChips)
  expect(profileChips).toHaveLength(10)
  for(const chip of profileChips)await expect(pillChips).toContainText(chip)
  await expect(pillChips).not.toContainText(/\+\s*\d/)

  // 速查：付俊松的 8 个正面标签全部以独立标签出现，没有展开更多按钮。
  await page.getByRole('button',{name:'查看导师 · 速查导师档案',exact:true}).click()
  const quick=page.getByRole('dialog',{name:'查看导师',exact:true})
  await quick.getByRole('textbox',{name:'搜索导师姓名、方向或关键词'}).fill('付俊松')
  const quickItem=quick.locator('.qs-item').filter({hasText:'付俊松'})
  await expect(quickItem).toHaveCount(1)
  await expect(quickItem.locator('.flag-chip.tone-good')).toHaveText(goodFlags)
  await expect(quickItem.locator('.tone-more')).toHaveCount(0)
  await expect(quickItem).toContainText('经费充足')
  await expect(quickItem).toContainText('补助 ¥2000/月')
  await page.keyboard.press('Escape')
  await expect(quick).toHaveCount(0)

  // 候选卡片：标签与实习、补助、管理三项事实完整显示，不截断。
  await page.getByRole('button',{name:'候选库 · 打开选导师工作台',exact:true}).click()
  const library=page.getByRole('dialog',{name:'候选库',exact:true})
  await expect(library).toBeVisible()
  await expect(page.getByRole('heading',{name:'我的导师候选',exact:true})).toBeVisible()
  const tile=page.locator('.mentor-tile').filter({hasText:'付俊松'})
  await expect(tile).toHaveCount(1)
  await expect(tile.locator('.flag-chip.tone-good')).toHaveText(goodFlags)
  await expect(tile.locator('.tone-more')).toHaveCount(0)
  const facts=tile.locator('.mentor-tile-facts')
  await expect(facts).toContainText('实习')
  await expect(facts).toContainText('补助')
  await expect(facts).toContainText('管理')
  await expect(library.getByRole('button',{name:/加入对比/})).toHaveCount(0)

  // 打开导师详情与档案：同样完整展示全部正面标签，且不再有加入对比入口。
  await tile.locator('.mentor-tile-name').click()
  const detail=page.locator('.workspace-detail')
  await expect(detail).toBeVisible()
  await expect(detail.getByRole('button',{name:/加入对比/})).toHaveCount(0)
  await detail.getByRole('button',{name:'导师档案',exact:true}).click()
  const dossier=page.getByRole('dialog',{name:'导师档案',exact:true})
  await expect(dossier).toBeVisible()
  const goodGroup=dossier.locator('.dossier-flags .flag-group.tone-good')
  await expect(goodGroup).toBeVisible()
  await expect(goodGroup.locator('li b')).toHaveText(goodFlags)
  await expect(dossier.locator('.tone-more')).toHaveCount(0)
  await expect(dossier.getByRole('button',{name:/加入对比/})).toHaveCount(0)
  await audit(page)
})
