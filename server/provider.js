import { randomUUID } from 'node:crypto'
import { normalizeBaseUrl } from './config.js'
import { emptyUsage } from './store.js'

export function parseDsmlToolCalls(text) {
  const source = String(text || ''), calls = []
  const invokeRe = /<[｜|]{1,2}DSML[｜|]{1,2}invoke\s+name="([^"]+)">([\s\S]*?)<\/[｜|]{1,2}DSML[｜|]{1,2}invoke>/g
  const paramRe = /<[｜|]{1,2}DSML[｜|]{1,2}parameter\s+name="([^"]+)"(?:\s+string="(true|false)")?\s*>([\s\S]*?)<\/[｜|]{1,2}DSML[｜|]{1,2}parameter>/g
  for (const match of source.matchAll(invokeRe)) {
    const name = match[1].trim(), args = {}
    for (const p of match[2].matchAll(paramRe)) {
      const key = p[1].trim(), isString = p[2] === 'true', raw = p[3]
      if (isString) args[key] = raw
      else {
        const trimmed = raw.trim()
        try { args[key] = JSON.parse(trimmed) }
        catch { args[key] = trimmed }
      }
    }
    if (name) calls.push({ id: `dsml-${randomUUID().slice(0, 8)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })
  }
  return calls
}

async function providerError(response, apiKey) {
  let message = `模型接口返回 HTTP ${response.status}`
  let code
  try {
    const body = await response.json()
    if (body.error?.message) message += `：${body.error.message}`
    code = body.error?.code || body.error?.type
  } catch { /* Some compatible servers return HTML error pages. */ }
  if (response.status === 401) message = 'API Key 无效或已失效，请在连接设置中更新。'
  if (response.status === 402) message = '模型账户余额不足，请检查服务商账户。'
  if (response.status === 429) message = '模型接口请求过于频繁，请稍后重试。'
  const detail = message.replaceAll(apiKey, '[已隐藏密钥]').slice(0, 800)
  if(response.status===400)message='模型服务未接受这次请求，请重试或更换模型。'
  else if(response.status===404)message='当前模型或服务地址不可用，请检查连接设置。'
  else if(response.status>=500)message='模型服务暂时不可用，请稍后重试。'
  const error = new Error(message)
  error.detail = detail
  error.status = response.status
  error.code = code
  error.contextOverflow = [400, 413, 422].includes(response.status) && /context[_ -]?(length|window)|maximum context|too many tokens|tokens?.*(exceed|too long)|上下文.*(超|长)/i.test(`${code || ''} ${detail}`)
  return error
}

export async function discoverModels(config, signal) {
  const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` }, signal: signal || AbortSignal.timeout(30000),
  })
  if (!response.ok) throw await providerError(response, config.apiKey)
  const body = await response.json()
  const models = (body.data || []).filter(model => typeof model.id === 'string').map(model => ({
    id: model.id, name: model.name || model.id,
    contextWindow: Number.isInteger(model.context_window) && model.context_window > 0 ? model.context_window : null,
    maxOutputTokens: Number.isInteger(model.max_output_tokens) && model.max_output_tokens > 0 ? model.max_output_tokens : null,
    reasoning: { levels: Array.isArray(model.effort?.supported_levels) ? model.effort.supported_levels.filter(v => typeof v === 'string') : [], defaultLevel: model.effort?.default_level || null, canDisable: model.effort?.supported_levels?.includes('none') || false },
  }))
  if (!models.length) throw new Error('接口没有返回可用模型。请展开高级设置填写支持工具调用的模型 ID。')
  return models
}

export async function listModels(config, signal) { return (await discoverModels(config, signal)).map(model => model.id) }

export function chooseModel(models, baseUrl) {
  if (new URL(baseUrl).hostname === 'api.deepseek.com' && models.includes('deepseek-flash')) return 'deepseek-flash'
  return models.find(id => !/embed|tts|whisper|image|audio|moderation/i.test(id)) || models[0]
}

export function normalizeUsage(raw) {
  const result = { ...emptyUsage(), requests: 1 }
  if (!raw || !Number.isFinite(raw.prompt_tokens) || !Number.isFinite(raw.completion_tokens)) {
    result.unreportedRequests = 1
    return result
  }
  result.inputTokens = raw.prompt_tokens
  result.outputTokens = raw.completion_tokens
  result.totalTokens = raw.total_tokens ?? raw.prompt_tokens + raw.completion_tokens
  result.cachedTokens = raw.prompt_cache_hit_tokens ?? raw.prompt_tokens_details?.cached_tokens ?? 0
  return result
}

export async function streamCompletion(config, messages, tools, { signal, onDelta = () => {}, onUsage = () => {}, onActivity = () => {}, maxTokens = 4096, responseFormat, toolChoice } = {}) {
  const baseUrl = normalizeBaseUrl(config.baseUrl)
  const officialDeepSeek = new URL(baseUrl).hostname === 'api.deepseek.com'
  const thinking = officialDeepSeek && config.reasoningEffort && config.reasoningEffort !== 'off'
  const choice=thinking&&toolChoice&&toolChoice!=='none'?'auto':toolChoice
  // Tool-mode thinking requires this field on every assistant turn, including empty reasoning and earlier non-thinking turns.
  const history = thinking && tools?.length ? messages.map(message=>message.role==='assistant'?{...message,reasoning_content:message.reasoning_content??''}:message) : messages
  const body = { model: config.model, messages:history, ...(tools?.length ? { tools } : {}), ...(choice?{tool_choice:choice}:{}), ...(responseFormat?{response_format:responseFormat}:{}), stream: true, stream_options: { include_usage: true }, max_tokens: maxTokens }
  if (officialDeepSeek) {
    body.thinking = { type: config.reasoningEffort && config.reasoningEffort !== 'off' ? 'enabled' : 'disabled' }
    if (config.reasoningEffort && !['off', 'auto'].includes(config.reasoningEffort)) body.reasoning_effort = config.reasoningEffort
  } else if (config.reasoningEffort && config.reasoningEffort !== 'auto') body.reasoning_effort = config.reasoningEffort === 'off' ? 'none' : config.reasoningEffort
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(body), signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(180000)]),
  })
  if (!response.ok) throw await providerError(response, config.apiKey)
  if (!response.body) throw new Error('模型接口没有返回响应流')
  const calls = [], message = { role: 'assistant', content: '', ...(thinking?{reasoning_content:''}:{}) }
  const activity=new Set()
  function mark(type,name){const key=`${type}:${name||''}`;if(!activity.has(key)){activity.add(key);onActivity({type,name})}}
  let finishReason = null, buffer = '', complete = false
  const decoder = new TextDecoder()
  function processEvent(event) {
    const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!data) return
    if (data === '[DONE]') { complete = true; return }
    const chunk = JSON.parse(data)
    if (chunk.error) throw new Error(String(chunk.error.message || '模型流返回错误').replaceAll(config.apiKey, '[已隐藏密钥]'))
    if (chunk.usage) onUsage(chunk.usage)
    const choice = chunk.choices?.[0]
    if (!choice) return
    if (choice.finish_reason) finishReason = choice.finish_reason
    const delta = choice.delta || {}
    if (delta.content) { mark('writing');message.content += delta.content; onDelta(delta.content) }
    if (delta.reasoning_content) { mark('thinking');message.reasoning_content = (message.reasoning_content || '') + delta.reasoning_content }
    for (const part of delta.tool_calls || []) {
      const index = part.index ?? 0
      calls[index] ||= { id: '', type: 'function', function: { name: '', arguments: '' } }
      if (part.id) calls[index].id = part.id
      if (part.function?.name) calls[index].function.name += part.function.name
      if(part.function?.name)mark('tool',calls[index].function.name)
      if (part.function?.arguments) calls[index].function.arguments += part.function.arguments
    }
  }
  for await (const bytes of response.body) {
    buffer = (buffer + decoder.decode(bytes, { stream: true })).replace(/\r\n/g, '\n')
    let end
    while ((end = buffer.indexOf('\n\n')) >= 0) { processEvent(buffer.slice(0, end)); buffer = buffer.slice(end + 2) }
  }
  buffer += decoder.decode()
  if (buffer.trim()) processEvent(buffer)
  if (!complete && !finishReason) throw new Error('模型响应流意外中断，请重试')
  if (finishReason === 'length') throw new Error('本次模型输出达到长度上限，请缩小问题范围后重试')
  if (finishReason === 'content_filter') throw new Error('模型服务商过滤了本次输出，请调整问题后重试')
  if(/<[｜|]{1,2}DSML[｜|]{1,2}/.test(message.content)){
    if(calls.length){
      message.content=message.content.replace(/<[｜|]{1,2}DSML[｜|]{1,2}[\s\S]*$/g,'').trim()
    }else{
      const dsmlCalls=parseDsmlToolCalls(message.content)
      if(dsmlCalls.length){
        for(const item of dsmlCalls){mark('tool',item.function.name);calls.push(item)}
        message.content=message.content.replace(/<[｜|]{1,2}DSML[｜|]{1,2}[\s\S]*$/g,'').trim()
      }else{
        const error=new Error('模型返回了无效响应，请重试此问题');error.protocolError=true;throw error
      }
    }
  }
  if (calls.length) {
    message.tool_calls = calls.filter(Boolean)
    message.content ||= null
    if (message.tool_calls.some(c => !c.id || !c.function.name)) throw new Error('模型返回了不完整的工具调用')
  }
  return message
}
