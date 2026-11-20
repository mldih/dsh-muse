window.__ModuleLoader__.load({
	id: '@deepseek-ai/dsh-muse',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");
		let h = React.createElement;

/**
 * @deepseek-ai/dsh-muse —— 浏览器半边（v1）。
 *
 * 入口：左侧栏图标列 → 主面板 `muse`；设置左侧导航 → Muse 设置页。
 * 面板：左侧三条灰底选中项（记忆 / 人格 / 计划），右侧内容区可上下滚动。
 * 记忆：只展示用户/模型新建的 memories/ 条目（按时间倒序，直接显示内容），
 *       不列出核心文件、不显示任何本机路径；画像与记忆库同页。
 * 计划：计划 + 三态台账。
 * 容量：有限额 / 无上限二选一；有限额时可输入数值并选 B/KB/MB/GB/TB。
 */

		const ID = '@deepseek-ai/dsh-muse';
		const PANEL = 'muse';
		const KIND = 'muse';
		const API = '/dsh-muse/api';
		const UNITS = [
			{ key: 'B', label: 'B', factor: 1 },
			{ key: 'KB', label: 'KB', factor: 1024 },
			{ key: 'MB', label: 'MB', factor: 1024 * 1024 },
			{ key: 'GB', label: 'GB', factor: 1024 * 1024 * 1024 },
			{ key: 'TB', label: 'TB', factor: 1024 * 1024 * 1024 * 1024 },
		];

		const C = {
			shell: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', color: 'inherit', fontSize: 14, lineHeight: 1.6, boxSizing: 'border-box' },
			head: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '24px 26px 12px' },
			h1: { margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: 0.2 },
			sub: { margin: '4px 0 0', fontSize: 12.5, opacity: 0.6 },
			tabbar: { display: 'flex', margin: '0 26px 16px', border: '1px solid rgba(127,127,127,0.16)', borderRadius: 10, overflow: 'hidden', background: 'transparent' },
			tab: { flex: 1, minWidth: 0, padding: '9px 8px', border: 0, background: 'rgba(127,127,127,0.07)', color: 'inherit', fontSize: 13, cursor: 'pointer', textAlign: 'center' },
			tabOn: { flex: 1, minWidth: 0, padding: '9px 8px', border: 0, background: 'transparent', color: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'center' },
			content: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 26px 44px' },
			sectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 },
			h2: { margin: 0, fontSize: 16, fontWeight: 650 },
			chip: { fontSize: 11, opacity: 0.55, border: '1px solid rgba(127,127,127,0.22)', borderRadius: 999, padding: '1px 8px' },
			card: { border: '1px solid rgba(127,127,127,0.14)', borderRadius: 12, padding: '14px 15px', background: 'transparent', marginBottom: 14 },
			cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 },
			cardTitle: { fontSize: 13.5, fontWeight: 600, opacity: 0.9 },
			muted: { opacity: 0.62, fontSize: 12.5 },
			bar: { height: 6, borderRadius: 999, background: 'transparent', border: '1px solid rgba(127,127,127,0.3)', overflow: 'hidden', margin: '6px 0' },
			fill: { height: 6, borderRadius: 999, background: 'rgba(120,150,200,0.85)' },
			row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
			btn: { padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.28)', background: 'transparent', color: 'inherit', fontSize: 12.5, cursor: 'pointer' },
			btnOn: { padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.55)', background: 'transparent', color: 'inherit', fontSize: 12.5, cursor: 'pointer', fontWeight: 600 },
			input: { boxSizing: 'border-box', padding: '6px 9px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.25)', background: 'transparent', color: 'inherit', fontSize: 13, outline: 'none', minWidth: 0 },
			area: { width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.25)', background: 'transparent', color: 'inherit', fontSize: 13, resize: 'vertical', outline: 'none' },
			field: { display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 },
			label: { fontSize: 12, opacity: 0.62 },
			mem: { padding: '11px 13px', borderRadius: 10, background: 'transparent', marginBottom: 10, border: '1px solid rgba(127,127,127,0.12)' },
			memTitle: { fontSize: 13.5, fontWeight: 600, marginBottom: 2 },
			memBody: { margin: '8px 0 0', padding: 0, fontSize: 12.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', opacity: 0.86, maxHeight: 360, overflow: 'auto' },
			empty: { textAlign: 'center', padding: '28px 10px', opacity: 0.58, fontSize: 13 },
			list: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 },
			li: { display: 'flex', gap: 9, alignItems: 'flex-start', padding: '9px 11px', borderRadius: 9, background: 'transparent', borderBottom: '1px solid rgba(127,127,127,0.1)' },
			dot: { width: 7, height: 7, borderRadius: 999, marginTop: 7, flex: 'none' },
			ok: { color: '#3f9b5a', fontSize: 12.5 },
			err: { color: '#d05555', fontSize: 12.5 },
			foot: { marginTop: 8, fontSize: 11.5, opacity: 0.45, lineHeight: 1.6 },
		};

		function fmtBytes(bytes) {
			if (!Number.isFinite(bytes)) return '-'
			if (bytes < 1024) return bytes + ' B'
			if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
			if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
			if (bytes < 1024 * 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
			return (bytes / 1024 / 1024 / 1024 / 1024).toFixed(2) + ' TB'
		}

		function fmtTime(iso) {
			const date = new Date(iso)
			if (Number.isNaN(date.getTime())) return ''
			const pad = value => (value < 10 ? '0' + value : String(value))
			return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
		}

		function levelLabel(level) {
			if (level === 'beginner') return '入门'
			if (level === 'intermediate') return '进阶'
			if (level === 'advanced') return '熟练'
			return '未评估'
		}

		function triLabel(tri) {
			if (tri === 'done') return '已完成'
			if (tri === 'missing') return '明确缺失'
			return '状态未知'
		}

		function triColor(tri) {
			if (tri === 'done') return 'rgba(80,170,110,0.95)'
			if (tri === 'missing') return 'rgba(210,140,70,0.95)'
			return 'rgba(150,120,230,0.95)'
		}

		async function apiGet() {
			const response = await fetch(API + '?t=' + Date.now(), { headers: { 'x-muse-client': 'dsh-muse' }, cache: 'no-store' })
			const data = await response.json()
			if (!data || !data.ok) throw new Error((data && data.error) || 'Muse API 未就绪')
			return data.state
		}

		async function apiPost(action, payload) {
			const response = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-muse-client': 'dsh-muse' }, body: JSON.stringify(Object.assign({ action }, payload || {})) })
			const data = await response.json()
			if (!data || !data.ok) throw new Error((data && data.error) || ('Muse API ' + action + ' 失败'))
			return data
		}

		function useMuseState() {
			const stateHook = React.useState({ loading: true, error: '', state: null })
			const state = stateHook[0]
			const setState = stateHook[1]
			const load = React.useCallback(() => {
				setState(previous => Object.assign({}, previous, { loading: true, error: '' }))
				apiGet().then(data => setState({ loading: false, error: '', state: data })).catch(error => {
					setState(previous => Object.assign({}, previous, { loading: false, error: String((error && error.message) || error) }))
				})
			}, [])
			React.useEffect(() => { load() }, [load])
			return { state, load }
		}

		function Card(props) {
			return h('div', { style: Object.assign({}, C.card, props.style || {}) }, props.children)
		}

		function CardHead(props) {
			return h('div', { style: C.cardHead }, h('span', { style: C.cardTitle }, props.title), props.children)
		}

		function Field(props) {
			return h('label', { style: C.field }, h('span', { style: C.label }, props.label), props.children)
		}

		function Bar(props) {
			const percent = Math.max(0, Math.min(100, Number(props.percent) || 0))
			return h('div', null,
				h('div', { style: C.bar }, h('div', { style: Object.assign({}, C.fill, { width: (props.maxBytes > 0 ? percent : 2) + '%' }) })),
				h('div', { style: C.muted }, fmtBytes(props.bytes) + ' / ' + (props.maxBytes > 0 ? fmtBytes(props.maxBytes) : '无上限')))
		}

		// ------------------------------------------------------------------
		// 容量：有限额 / 无上限 + 数值 + 单位
		// ------------------------------------------------------------------
		function pickUnit(maxBytes) {
			if (!maxBytes || maxBytes <= 0) return { amount: '', unit: 'GB' }
			for (let index = UNITS.length - 1; index >= 0; index -= 1) {
				const unit = UNITS[index]
				if (maxBytes >= unit.factor) {
					const amount = Math.round((maxBytes / unit.factor) * 100) / 100
					return { amount: String(amount), unit: unit.key }
				}
			}
			return { amount: String(maxBytes), unit: 'B' }
		}

		function CapacityCard(props) {
			const current = props.current
			const initial = pickUnit(current.usage.maxBytes)
			const modeHook = React.useState(current.usage.maxBytes > 0 ? 'limited' : 'unlimited')
			const amountHook = React.useState(initial.amount)
			const unitHook = React.useState(initial.unit)
			const busyHook = React.useState(false)
			const msgHook = React.useState({ text: '', error: false })
			const mode = modeHook[0], setMode = modeHook[1]
			const amount = amountHook[0], setAmount = amountHook[1]
			const unit = unitHook[0], setUnit = unitHook[1]
			const busy = busyHook[0], setBusy = busyHook[1]
			const msg = msgHook[0], setMsg = msgHook[1]
			const unlimited = mode === 'unlimited'

			const save = React.useCallback(() => {
				let bytes = 0
				if (!unlimited) {
					const value = Number(amount)
					const factor = (UNITS.find(item => item.key === unit) || UNITS[2]).factor
					if (!Number.isFinite(value) || value <= 0) { setMsg({ text: '请输入大于 0 的上限，或选择「无上限」', error: true }); return }
					bytes = Math.max(1, Math.floor(value * factor))
				}
				setBusy(true)
				apiPost('save-limits', { maxBytes: bytes, autoCompact: true })
					.then(data => { setMsg({ text: unlimited ? '已设为无上限' : '已保存上限', error: false }); props.reload(); return data })
					.catch(error => setMsg({ text: String((error && error.message) || error), error: true }))
					.finally(() => setBusy(false))
			}, [unlimited, amount, unit])

			return h(Card, null,
				h(CardHead, { title: '存储上限' },
					h('span', { style: C.muted }, fmtBytes(current.usage.bytes))),
				h('div', { style: { display: 'flex', gap: 4, marginBottom: 12 } },
					h('button', { type: 'button', style: mode === 'limited' ? C.btnOn : C.btn, onClick: () => setMode('limited') }, '有限额'),
					h('button', { type: 'button', style: unlimited ? C.btnOn : C.btn, onClick: () => { setMode('unlimited'); setMsg({ text: '', error: false }) } }, '无上限')),
				h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
					h('input', {
						style: Object.assign({}, C.input, {
							flex: '1 1 120px', width: 0,
							opacity: unlimited ? 0.45 : 1,
							cursor: unlimited ? 'not-allowed' : 'text',
						}),
						value: unlimited ? '' : amount,
						disabled: unlimited,
						placeholder: unlimited ? '无上限' : '输入数值',
						inputMode: 'decimal',
						onChange: event => setAmount(event.target.value),
					}),
					h('select', {
						style: Object.assign({}, C.input, {
							flex: '0 0 76px', width: 76,
							opacity: unlimited ? 0.45 : 1,
							cursor: unlimited ? 'not-allowed' : 'pointer',
						}),
						value: unit,
						disabled: unlimited,
						onChange: event => setUnit(event.target.value),
					}, UNITS.map(item => h('option', { key: item.key, value: item.key }, item.label)))),
				h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10, flexWrap: 'wrap' } },
					h('span', { style: msg.error ? C.err : C.ok, overflowWrap: 'anywhere', minWidth: 0 }, msg.text),
					h('button', { type: 'button', style: Object.assign({}, C.btnOn, { flex: '0 0 auto' }), onClick: save, disabled: busy }, busy ? '保存中…' : '保存')),
				h('div', { style: { marginTop: 4 } }, h(Bar, { bytes: current.usage.bytes, maxBytes: current.usage.maxBytes, percent: current.usage.percent })),
				h('div', { style: Object.assign({}, C.muted, { overflowWrap: 'anywhere' }) }, '达到上限会自动压缩、归档或删除较旧内容；选择无上限后输入框不可编辑。'))
		}

		// ------------------------------------------------------------------
		// 画像
		// ------------------------------------------------------------------
		function ProfileForm(props) {
			const profile = props.current.profile || {}
			const levelHook = React.useState(profile.level || 'unknown')
			const interestsHook = React.useState((profile.interests || []).join('、'))
			const summaryHook = React.useState(profile.summary || '')
			const conceptsHook = React.useState(JSON.stringify(profile.concepts || {}, null, 2))
			const busyHook = React.useState(false)
			const msgHook = React.useState({ text: '', error: false })
			const level = levelHook[0], setLevel = levelHook[1]
			const interests = interestsHook[0], setInterests = interestsHook[1]
			const summary = summaryHook[0], setSummary = summaryHook[1]
			const concepts = conceptsHook[0], setConcepts = conceptsHook[1]
			const busy = busyHook[0], setBusy = busyHook[1]
			const msg = msgHook[0], setMsg = msgHook[1]

			const save = React.useCallback(() => {
				let parsed
				try { parsed = concepts.trim() ? JSON.parse(concepts) : {} } catch (error) { setMsg({ text: '概念 JSON 不合法：' + (error && error.message), error: true }); return }
				setBusy(true)
				apiPost('save-profile', { profile: { level, interests: interests.split(/[、,，]/).map(item => item.trim()).filter(Boolean), summary, concepts: parsed } })
					.then(data => { setMsg({ text: '画像已保存，下一次回复即按新画像讲解', error: false }); props.reload(); return data })
					.catch(error => setMsg({ text: String((error && error.message) || error), error: true }))
					.finally(() => setBusy(false))
			}, [level, interests, summary, concepts])

			return h(Card, null,
				h(CardHead, { title: '用户画像' },
					h('span', { style: C.muted }, levelLabel(level))),
				h(Field, { label: '能力等级' },
					h('select', { style: Object.assign({}, C.input, { width: '100%' }), value: level, onChange: event => setLevel(event.target.value) },
						h('option', { value: 'unknown' }, '未评估'),
						h('option', { value: 'beginner' }, '入门'),
						h('option', { value: 'intermediate' }, '进阶'),
						h('option', { value: 'advanced' }, '熟练'))),
				h(Field, { label: '兴趣与方向' },
					h('input', { style: Object.assign({}, C.input, { width: '100%' }), value: interests, onChange: event => setInterests(event.target.value), placeholder: '用顿号或逗号分隔' })),
				h(Field, { label: '画像摘要（可自己写，AI 会持续更新）' },
					h('textarea', { style: C.area, rows: 4, value: summary, onChange: event => setSummary(event.target.value) })),
				h(Field, { label: '概念熟悉度（0 未接触 / 1 听过 / 2 能复述 / 3 能应用）' },
					h('textarea', { style: C.area, rows: 6, value: concepts, onChange: event => setConcepts(event.target.value), spellCheck: false })),
				h('div', { style: C.row },
					h('span', { style: msg.error ? C.err : C.ok }, msg.text),
					h('button', { type: 'button', style: C.btnOn, onClick: save, disabled: busy }, busy ? '保存中…' : '保存画像')))
		}

		// ------------------------------------------------------------------
		// 人格
		// ------------------------------------------------------------------
		function PersonaForm(props) {
			const persona = props.current.persona || {}
			const nameHook = React.useState(persona.name || 'Muse')
			const toneHook = React.useState(persona.tone || '温和严谨')
			const depthHook = React.useState(persona.depth || '跟随画像')
			const languageHook = React.useState(persona.language || '中文')
			const styleHook = React.useState(persona.style || '')
			const customHook = React.useState(persona.custom || '')
			const busyHook = React.useState(false)
			const msgHook = React.useState({ text: '', error: false })
			const name = nameHook[0], setName = nameHook[1]
			const tone = toneHook[0], setTone = toneHook[1]
			const depth = depthHook[0], setDepth = depthHook[1]
			const language = languageHook[0], setLanguage = languageHook[1]
			const style = styleHook[0], setStyle = styleHook[1]
			const custom = customHook[0], setCustom = customHook[1]
			const busy = busyHook[0], setBusy = busyHook[1]
			const msg = msgHook[0], setMsg = msgHook[1]

			const save = React.useCallback(() => {
				setBusy(true)
				apiPost('save-persona', { persona: { name, tone, depth, language, style, custom } })
					.then(data => { setMsg({ text: '人格已保存，立即注入下一次模型调用', error: false }); props.reload(); return data })
					.catch(error => setMsg({ text: String((error && error.message) || error), error: true }))
					.finally(() => setBusy(false))
			}, [name, tone, depth, language, style, custom])

			function choose(label, value, onChange, options) {
				return h(Field, { label }, h('select', { style: Object.assign({}, C.input, { width: '100%' }), value, onChange: event => onChange(event.target.value) }, options.map(option => h('option', { key: option, value: option }, option))))
			}

			return h('div', null,
				h(Card, null,
					h(CardHead, { title: '说话方式' }),
					h(Field, { label: '名字' }, h('input', { style: Object.assign({}, C.input, { width: '100%' }), value: name, onChange: event => setName(event.target.value) })),
					choose('语气', tone, setTone, ['温和严谨', '亲切耐心', '简洁直接', '幽默轻松', '严格教练']),
					choose('讲解深度', depth, setDepth, ['跟随画像', '新手向（多举例子）', '进阶（点到为止）', '专家向（直接给方法）']),
					choose('语言', language, setLanguage, ['中文', '英文', '中英双语'])),
				h(Card, null,
					h(CardHead, { title: '表达风格与自定义' }),
					h(Field, { label: '表达风格' }, h('textarea', { style: C.area, rows: 3, value: style, onChange: event => setStyle(event.target.value) })),
					h(Field, { label: '自定义要求（拼进每次模型调用）' }, h('textarea', { style: C.area, rows: 3, value: custom, onChange: event => setCustom(event.target.value) }))),
				h('div', { style: C.row },
					h('span', { style: msg.error ? C.err : C.ok }, msg.text),
					h('button', { type: 'button', style: C.btnOn, onClick: save, disabled: busy }, busy ? '保存中…' : '保存人格')))
		}

		// ------------------------------------------------------------------
		// 记忆条目
		// ------------------------------------------------------------------
		function MemoryList(props) {
			const memories = Array.isArray(props.current.memories) ? props.current.memories : []
			const busyHook = React.useState('')
			const busy = busyHook[0], setBusy = busyHook[1]
			const msgHook = React.useState({ text: '', error: false })
			const msg = msgHook[0], setMsg = msgHook[1]

			const remove = React.useCallback(name => {
				if (typeof window !== 'undefined' && !window.confirm('删除这条记忆？')) return
				setBusy(name)
				apiPost('delete-memory', { name })
					.then(data => { setMsg({ text: '已删除', error: false }); props.reload(); return data })
					.catch(error => setMsg({ text: String((error && error.message) || error), error: true }))
					.finally(() => setBusy(''))
			}, [])

			return h(Card, null,
				h(CardHead, { title: '记忆库' },
					h('span', { style: C.muted }, memories.length + ' 条')),
				msg.text ? h('div', { style: msg.error ? C.err : C.ok }, msg.text) : null,
				memories.length === 0
					? h('div', { style: C.empty }, '还没有新建记忆。在对话里让 Agent 用 muse_memory action=remember 记录一条，这里会按时间倒序直接显示内容。')
					: h('div', null, memories.map(memory => h('div', { key: memory.name, style: C.mem },
						h('div', { style: C.row },
							h('div', { style: C.memTitle }, memory.title || '记忆'),
							h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
								h('span', { style: C.muted }, fmtTime(memory.at)),
								h('button', { type: 'button', style: C.btn, onClick: () => remove(memory.name), disabled: busy === memory.name }, busy === memory.name ? '删除中…' : '删除'))),
						h('pre', { style: C.memBody }, memory.content || ''))))
			)
		}

		// ------------------------------------------------------------------
		// 计划 / 台账
		// ------------------------------------------------------------------
		function PlanList(props) {
			const plans = (props.current.plan && Array.isArray(props.current.plan.plans)) ? props.current.plan.plans : []
			const items = (props.current.ledger && Array.isArray(props.current.ledger.items)) ? props.current.ledger.items : []
			return h('div', null,
				h(Card, null,
					h(CardHead, { title: '学习/科研计划' }, h('span', { style: C.muted }, plans.length + ' 个')),
					plans.length === 0
						? h('div', { style: C.empty }, '还没有计划。在对话里让 Agent 用 muse_plan 生成。')
						: h('div', null, plans.map((plan, index) => {
							const milestones = Array.isArray(plan.milestones) ? plan.milestones : []
							const done = milestones.filter(milestone => milestone && milestone.status === 'done').length
							return h('div', { key: index, style: C.mem },
								h('div', { style: C.memTitle }, plan.title || plan.id || '未命名计划'),
								plan.goal ? h('div', { style: { fontSize: 12.5, opacity: 0.8, marginTop: 2 } }, plan.goal) : null,
								milestones.length > 0 ? h('div', { style: C.bar }, h('div', { style: Object.assign({}, C.fill, { width: Math.round(done * 100 / milestones.length) + '%' }) })) : null,
								h('div', { style: C.muted }, milestones.length > 0 ? done + ' / ' + milestones.length + ' 个里程碑完成' : '暂无里程碑'),
								milestones.length > 0 ? h('ul', { style: Object.assign({}, C.list, { marginTop: 8 }) }, milestones.map((milestone, i) => h('li', { key: i, style: C.li },
									h('span', { style: Object.assign({}, C.dot, { background: milestone.status === 'done' ? triColor('done') : 'rgba(127,127,127,0.5)' }) }),
									h('div', null, milestone.title || '', milestone.due ? h('div', { style: C.muted }, '截止 ' + milestone.due) : null)))) : null)
						}))),
				h(Card, null,
					h(CardHead, { title: '三态台账' }, h('span', { style: C.muted }, items.length + ' 项')),
					items.length === 0
						? h('div', { style: C.empty }, '台账为空。在对话里让 Agent 用 muse_ledger 记录。')
						: h('ul', { style: C.list }, items.map((item, index) => h('li', { key: index, style: C.li },
							h('span', { style: Object.assign({}, C.dot, { background: triColor(item.tri) }) }),
							h('div', { style: { flex: 1 } },
								h('div', { style: C.row }, h('span', null, item.title || ''), h('span', { style: C.muted }, triLabel(item.tri))),
								h('div', { style: C.muted }, (item.detail || '') + (item.nextAction ? ' → ' + item.nextAction : ''))))))))
		}

		// ------------------------------------------------------------------
		// 页面骨架：左三栏 + 右内容
		// ------------------------------------------------------------------
		function Shell(props) {
			const compact = props.compact === true
			return h('div', { style: Object.assign({}, C.shell, compact ? { fontSize: 13 } : null) },
				h('header', { style: Object.assign({}, C.head, compact ? { padding: '16px 14px 8px' } : null) },
					h('div', null,
						h('h1', { style: Object.assign({}, C.h1, compact ? { fontSize: 21 } : null) }, 'Muse'),
						h('p', { style: C.sub }, '你的科研学习助手')),
					h('button', { type: 'button', style: C.btn, onClick: props.reload, disabled: props.loading }, props.loading ? '刷新中…' : '刷新')),
				h('nav', { style: Object.assign({}, C.tabbar, compact ? { margin: '0 14px 12px' } : null) },
					props.tabs.map(tab => h('button', {
						key: tab.id, type: 'button',
						style: props.active === tab.id ? C.tabOn : C.tab,
						onClick: () => props.onChange(tab.id),
					}, tab.label))),
				h('div', { style: Object.assign({}, C.content, compact ? { padding: '2px 14px 28px' } : null) }, props.children))
		}

		function MusePage(props) {
			const compact = props && props.compact === true
			const store = useMuseState()
			const tabHook = React.useState('memory')
			const tab = tabHook[0]
			const setTab = tabHook[1]
			const current = store.state.state

			if (store.state.error) {
				return h(Shell, { compact, tabs: [{ id: 'memory', label: '记忆' }], active: 'memory', onChange: () => {}, reload: store.load, loading: store.state.loading, children:
					h('div', { style: C.empty }, '插件宿主接口未就绪：' + store.state.error) })
			}
			if (!current) {
				return h(Shell, { compact, tabs: [{ id: 'memory', label: '记忆' }], active: 'memory', onChange: () => {}, reload: store.load, loading: store.state.loading, children:
					h('div', { style: C.empty }, '读取中…') })
			}

			const tabs = [
				{ id: 'memory', label: '记忆' },
				{ id: 'persona', label: '人格' },
				{ id: 'plan', label: '计划' },
			]

			let body = null
			if (tab === 'memory') {
				body = h('div', null,
					h('div', { style: C.sectionHead }, h('h2', { style: C.h2 }, '记忆'), h('span', { style: C.chip }, '记忆库 · 画像')),
					h(CapacityCard, { current, reload: store.load }),
					h(MemoryList, { current, reload: store.load }),
					h(ProfileForm, { current, reload: store.load }))
			}
			if (tab === 'persona') {
				body = h('div', null,
					h('div', { style: C.sectionHead }, h('h2', { style: C.h2 }, '人格'), h('span', { style: C.chip }, '名字 · 语气 · 讲解深度')),
					h(PersonaForm, { current, reload: store.load }))
			}
			if (tab === 'plan') {
				body = h('div', null,
					h('div', { style: C.sectionHead }, h('h2', { style: C.h2 }, '计划'), h('span', { style: C.chip }, '计划 · 台账')),
					h(PlanList, { current }))
			}

			return h(Shell, { compact, tabs, active: tab, onChange: setTab, reload: store.load, loading: store.state.loading, children: [
				h('div', { key: 'body' }, body),
				h('div', { key: 'foot', style: C.foot }, '记忆采集只写本机、不参与模型输入；缺口提醒为判断辅助，不构成学术不端认定。'),
			] })
		}

		// ------------------------------------------------------------------
		// 设置页
		// ------------------------------------------------------------------
		function MuseSettings() {
			const store = useMuseState()
			const current = store.state.state
			const page = { maxWidth: 720, margin: '0 auto', padding: '24px 20px 40px', height: '100%', overflowY: 'auto', boxSizing: 'border-box', fontSize: 14, lineHeight: 1.6 }
			if (store.state.error) return h('div', { style: page }, h('div', { style: C.empty }, '接口未就绪：' + store.state.error))
			if (!current) return h('div', { style: page }, h('div', { style: C.empty }, '读取中…'))
			return h('div', { style: page },
				h('div', { style: { padding: '4px 0 16px' } }, h('h1', { style: C.h1 }, 'Muse'), h('p', { style: C.sub }, '你的科研学习助手')),
				h(PersonaForm, { current, reload: store.load }),
				h(CapacityCard, { current, reload: store.load }),
				h('div', { style: C.foot }, '记忆库位于应用专属目录，跨会话固定复用；思考与正文采集只写本机。'))
		}

		// ------------------------------------------------------------------
		// 图标与注册
		// ------------------------------------------------------------------
		function Glyph(props) {
			const size = props && props.size ? props.size : 18
			return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
				h('path', { d: 'M4 18V7.5L9.5 13 15 7.5V18' }),
				h('path', { d: 'M18.5 10.5v7.5' }))
		}

		function PanelIcon(props) { return h(Glyph, { size: props && props.size }) }
		function SettingsIcon(props) { return h(Glyph, { size: props && props.size }) }
		function MuseSidePanel() { return h(MusePage, { compact: true }) }

		function apply(ctx) {
			ctx.effect(function () {
				return ctx.slots.inject('main', function () {
					return ctx.slots.register({ name: 'main', key: PANEL }, MusePage)
				})
			}, 'dsh-muse: main panel')

			ctx.effect(function () {
				return ctx.slots.inject('sidebar.panellist', function () {
					return ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 15, label: function () { return 'Muse' } }, PanelIcon)
				})
			}, 'dsh-muse: sidebar icon')

			ctx.effect(function () {
				return ctx.slots.inject('settings.section', function () {
					return ctx.slots.register({ name: 'settings.section', id: 'muse', order: 40, label: function () { return 'Muse' } }, MusePage)
				})
			}, 'dsh-muse: settings section')

			ctx.effect(function () {
				return ctx.slots.inject('settings.section.icon', function () {
					return ctx.slots.register({ name: 'settings.section.icon', id: 'muse', order: 40 }, SettingsIcon)
				})
			}, 'dsh-muse: settings icon')

			/* 兼容旧版右侧栏 Muse 标签，避免历史布局出现无法预览。 */
			ctx.effect(function () {
				return ctx.sidebarRightTabs.register({
					id: ID, kind: KIND, priority: 'extension',
					title: function () { return 'Muse' },
					guide: [{ id: 'muse', order: 60, title: function () { return 'Muse 学习科研助理' }, description: function () { return '记忆、人格与计划' } }],
				})
			}, 'dsh-muse: tab type')
			ctx.effect(function () {
				return ctx.slots.inject('sidebar.right.pane.tab', function () {
					return ctx.slots.register({ name: 'sidebar.right.pane.tab', key: ID }, MuseSidePanel)
				})
			}, 'dsh-muse: side body')
			ctx.effect(function () {
				return ctx.slots.inject('sidebar.right.pane.tab.title', function () {
					return ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: ID }, function MuseTitle() { return h('span', { style: { fontWeight: 600 } }, 'Muse') })
				})
			}, 'dsh-muse: side title')
		}

		const inject = ['slots', 'sidebarRightTabs', 'sidebarRight'];

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});