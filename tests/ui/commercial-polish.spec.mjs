import {test,expect} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

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

async function openWorkbench(page){
  await page.goto('/')
  await page.getByRole('button',{name:'候选库 · 打开选导师工作台',exact:true}).click()
  await expect(page.getByRole('heading',{name:'我的导师候选',exact:true})).toBeVisible()
}

test('全校14院官网导师发现与官网学术档案完整展示且通过无障碍检查',async({page})=>{
  await openWorkbench(page)
  await page.getByRole('button',{name:'添加导师',exact:true}).click()

  const college=page.getByLabel('按学院筛选候选',{exact:true})
  await expect(college).toBeVisible()
  expect(await college.locator('option').count()).toBeGreaterThanOrEqual(14)

  const filtered=page.waitForResponse(response=>response.url().includes('/api/workbench/directory')&&decodeURIComponent(response.url()).includes('college=信息与通信工程学院'))
  await college.selectOption({label:'信息与通信工程学院'})
  await filtered

  const firstCard=page.locator('.mentor-tile').first()
  await expect(firstCard).toBeVisible()
  await expect(firstCard).toContainText('信息与通信工程学院')
  await expect(firstCard.locator('.mentor-degree, .mentor-directions').first()).toBeVisible()

  await firstCard.locator('.mentor-tile-name').click()
  await expect(page.locator('.workspace-detail')).toBeVisible()
  await page.getByRole('button',{name:'导师档案',exact:true}).click()

  const dossier=page.getByRole('dialog',{name:'导师档案'})
  await expect(dossier).toBeVisible()
  const official=dossier.getByRole('region',{name:'学校官网学术档案'})
  await expect(official).toBeVisible()
  await expect(official).toContainText('学校官网学术档案')
  await audit(page)
})

test('跨学院同名导师候选与14院画像多选不截断',async({page,request})=>{
  const directory=await (await request.get('/api/workbench/directory?q='+encodeURIComponent('刘勇'))).json()
  expect(directory.rows.length).toBeGreaterThanOrEqual(2)
  expect(new Set(directory.rows.map(row=>row.college)).size).toBeGreaterThanOrEqual(2)
  await request.post('/api/workbench/items',{data:{mentors:directory.rows.map(row=>({key:row.key}))}})
  await request.delete('/api/profile')
  await page.goto('/')

  await page.getByRole('button',{name:'设置我的择导画像',exact:true}).click()
  const profile=page.getByRole('dialog',{name:'我的择导画像'})
  const collegeChoices=profile.getByRole('group',{name:'关注学院'}).getByRole('button')
  const collegeCount=await collegeChoices.count()
  expect(collegeCount).toBeGreaterThanOrEqual(14)
  for(let index=0;index<collegeCount;index++)await collegeChoices.nth(index).click()
  expect(await collegeChoices.evaluateAll(buttons=>buttons.every(button=>button.getAttribute('aria-pressed')==='true'))).toBe(true)
  await profile.getByRole('button',{name:'保存画像'}).click()
  await expect(profile).toHaveCount(0)
  const saved=await (await request.get('/api/profile')).json()
  expect(saved.profile.colleges).toHaveLength(collegeCount)
  expect(saved.profile.colleges).toContain('信息与通信工程学院')

  await page.getByRole('button',{name:'候选库 · 打开选导师工作台',exact:true}).click()
  const library=page.getByRole('dialog',{name:'候选库',exact:true})
  await expect(library).toBeVisible()
  await expect(page.getByRole('heading',{name:'我的导师候选',exact:true})).toBeVisible()

  const tiles=library.locator('.mentor-tile').filter({hasText:'刘勇'})
  await expect(tiles).toHaveCount(directory.rows.length)
  for(const row of directory.rows)await expect(tiles.filter({hasText:row.college})).toHaveCount(1)
  await expect(library.getByRole('button',{name:/加入对比/})).toHaveCount(0)
  await audit(page)
})
