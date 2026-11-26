import fs from 'node:fs'

export function outputBudget(config) {
  const window = config.contextWindow || 32768
  return Math.max(256, Math.min(config.maxOutputTokens || 4096, 16384, Math.floor(window / (config.reasoningEnabled ? 3 : 8))))
}

export function compressionBudget(config) {
  const window = config.contextWindow || 32768
  const max = Math.max(1024, window - outputBudget(config) - 1024)
  return { trigger: Math.min(config.compressionThresholdTokens || Math.floor(window * 0.8), max), min: Math.min(8192, Math.floor(max * 0.5)), max }
}

export function normalizeBaseUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('API URL 需要是完整的 http:// 或 https:// 地址') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API URL 仅支持不含账号、查询参数的 HTTP(S) 地址')
  url.pathname = url.pathname.replace(/\/(chat\/completions|models)\/?$/, '').replace(/\/$/, '')
  if (url.hostname === 'api.deepseek.com' && url.pathname === '/anthropic') url.pathname = ''
  return url.toString().replace(/\/$/, '')
}

export function maskApiKey(key) {
  const value = String(key || '').trim()
  if (!value) return ''
  if (value.length <= 10) return '****'
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}

export function isLocalOllamaUrl(value) {
  try {
    const url = new URL(normalizeBaseUrl(value))
    return ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '11434'
  } catch {
    return false
  }
}

export function createConfig(store, env = process.env) {
  const saved = store.read('config', {})
  const preferUi = saved.source === 'ui' && !env.MENTOR_CONFIG_OVERRIDE && !env.MENTOR_API_KEY
  let current = {
    baseUrl: (preferUi ? saved.baseUrl : env.MENTOR_API_URL || saved.baseUrl) || 'https://api.deepseek.com',
    model: (preferUi ? saved.model : env.MENTOR_MODEL || saved.model) || '',
    apiKey: env.MENTOR_API_KEY || saved.apiKey || '',
    models: saved.models || [],
    contextWindow: Number(env.MENTOR_CONTEXT_TOKENS) || null,
    reasoningEffort: saved.reasoningEffort || 'off',
    compressionThresholdTokens: saved.compressionThresholdTokens || null,
  }
  const keyFile = env.MENTOR_API_KEY_FILE
  const keyFromFile = () => keyFile ? fs.readFileSync(keyFile, 'utf8').trim() : ''
  const effective = () => {
    const model = current.models.find(m => m.id === current.model)
    const official = new URL(current.baseUrl).hostname === 'api.deepseek.com'
    const levels = model?.reasoning?.levels || (official ? ['low', 'high', 'max'] : [])
    const canDisable = official || model?.reasoning?.canDisable || false
    const reasoningOptions = ['auto', ...(canDisable ? ['off'] : []), ...levels.filter(level => level !== 'none')]
    const reasoningEffort = reasoningOptions.includes(current.reasoningEffort) ? current.reasoningEffort : 'auto'
    return { ...current, contextWindow: current.contextWindow || model?.contextWindow || 32768, contextWindowKnown: Boolean(current.contextWindow || model?.contextWindow), maxOutputTokens: model?.maxOutputTokens || (official ? 8192 : 4096), apiKey: current.apiKey || keyFromFile(), reasoningEffort, reasoningOptions, reasoningDefaultLevel: model?.reasoning?.defaultLevel || (official ? 'high' : null), reasoningEnabled: reasoningEffort !== 'off' && (official || reasoningEffort !== 'auto' || Boolean(model?.reasoning?.defaultLevel && model.reasoning.defaultLevel !== 'none')) }
  }
  const publicConfig = () => {
    const value = effective(), budget = compressionBudget(value)
    return { baseUrl: current.baseUrl, model: current.model, models: current.models, contextWindow: value.contextWindow, contextWindowKnown: value.contextWindowKnown, reasoningEffort: value.reasoningEffort, reasoningOptions: value.reasoningOptions, reasoningDefaultLevel: value.reasoningDefaultLevel, compressionThresholdTokens: current.compressionThresholdTokens, compressionTriggerTokens: budget.trigger, compressionMinTokens: budget.min, compressionMaxTokens: budget.max, outputReserveTokens: outputBudget(value), configured: Boolean(value.apiKey && current.model), hasKey: Boolean(value.apiKey), maskedKey: maskApiKey(value.apiKey) }
  }
  function candidate(input) {
    const baseUrl = normalizeBaseUrl(input.baseUrl || current.baseUrl)
    let apiKey = input.apiKey?.trim() || (baseUrl === normalizeBaseUrl(current.baseUrl) ? effective().apiKey : '')
    if (!apiKey && isLocalOllamaUrl(baseUrl)) apiKey = 'ollama'
    if (!apiKey) throw new Error('请填写 API Key；更换 API 地址时需要重新填写密钥')
    return { baseUrl, apiKey, model: input.model?.trim() || '' }
  }
  return {
    effective, publicConfig, candidate,
    updateExecution(input) {
      const before = effective()
      if (input.reasoningEffort !== undefined && !before.reasoningOptions.includes(input.reasoningEffort)) throw new Error('当前模型不支持这个推理档位，请从模型声明的档位中选择')
      const next = { ...before, ...(input.reasoningEffort !== undefined ? { reasoningEffort: input.reasoningEffort, reasoningEnabled: input.reasoningEffort !== 'off' && (new URL(before.baseUrl).hostname === 'api.deepseek.com' || input.reasoningEffort !== 'auto' || Boolean(before.reasoningDefaultLevel && before.reasoningDefaultLevel !== 'none')) } : {}) }
      const budget = compressionBudget(next), tokens = input.compressionThresholdTokens
      if (tokens !== undefined && tokens !== null && (!Number.isInteger(tokens) || tokens < budget.min || tokens > budget.max)) throw new Error(`压缩阈值需要为 ${budget.min}–${budget.max} 之间的整数 Token，或选择自动管理`)
      if (input.reasoningEffort !== undefined) current.reasoningEffort = input.reasoningEffort
      if (tokens !== undefined) current.compressionThresholdTokens = tokens
      Object.assign(saved, { reasoningEffort: current.reasoningEffort, compressionThresholdTokens: current.compressionThresholdTokens })
      store.write('config', saved)
      return publicConfig()
    },
    setModels(models) { current.models = models; Object.assign(saved, { baseUrl: current.baseUrl, model: current.model, models }); store.write('config', saved); return models },
    selectModel(model) {
      if (!current.models.some(m => m.id === model)) throw new Error('请从已加载的模型列表中选择，或在连接设置中填写自定义模型')
      current.model = model; saved.model = model; saved.models = current.models; saved.source = 'ui'; saved.updatedAt = new Date().toISOString()
      store.write('config', saved)
      return publicConfig()
    },
    save(config, input, models = []) {
      // External key files remain external; never copy a test credential into the repo or config.
      current = { ...current, ...config, models }
      const persisted = { source: 'ui', updatedAt: new Date().toISOString(), baseUrl: config.baseUrl, model: config.model, models, reasoningEffort: current.reasoningEffort, compressionThresholdTokens: current.compressionThresholdTokens, ...(input.apiKey?.trim() ? { apiKey: config.apiKey } : saved.apiKey && config.apiKey === saved.apiKey ? { apiKey: saved.apiKey } : {}) }
      Object.assign(saved, persisted)
      if (!persisted.apiKey) delete saved.apiKey
      store.write('config', persisted)
      return publicConfig()
    },
    redact(message) {
      const key = effective().apiKey
      return String(message).replaceAll(key || '\u0000', '[已隐藏密钥]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]')
    },
  }
}
