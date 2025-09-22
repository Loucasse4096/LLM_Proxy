import { useQuery, proxyPrompt } from 'wasp/client/operations'
import { useState } from 'react'
import { getLogs, getStats } from 'wasp/client/operations'

export function DashboardPage() {
  const { data: stats } = useQuery(getStats, {})
  const [filters, setFilters] = useState<{ decision?: string; risk?: string }>({})
  const { data: logs } = useQuery(getLogs, { decision: filters.decision as any, risk: filters.risk as any })
  const [testPrompt, setTestPrompt] = useState('Explique-moi les closures en JavaScript.')
  const [testLoading, setTestLoading] = useState(false)
  const [testResult, setTestResult] = useState<any>(null)

  async function handleTest() {
    try {
      setTestLoading(true)
      const res = await proxyPrompt({ prompt: testPrompt })
      setTestResult(res)
    } catch (e:any) {
      setTestResult({ error: e?.message || String(e) })
    } finally {
      setTestLoading(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Dashboard</h1>
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard title="Total appels" value={stats?.countAll ?? '-'} />
        <StatCard title="ALLOW" value={stats?.byDecision?.find((d:any)=>d.decision==='ALLOW')?._count?._all ?? 0} />
        <StatCard title="BLOCK" value={stats?.byDecision?.find((d:any)=>d.decision==='BLOCK')?._count?._all ?? 0} />
      </div>
      <div className="flex items-end gap-4 mb-4">
        <div>
          <label className="block text-xs text-neutral-600">Decision</label>
          <select className="border rounded px-2 py-1" value={filters.decision ?? ''} onChange={(e)=> setFilters(f=> ({...f, decision: e.target.value || undefined}))}>
            <option value="">All</option>
            <option value="ALLOW">ALLOW</option>
            <option value="MASK">MASK</option>
            <option value="BLOCK">BLOCK</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-neutral-600">Risk</label>
          <select className="border rounded px-2 py-1" value={filters.risk ?? ''} onChange={(e)=> setFilters(f=> ({...f, risk: e.target.value || undefined}))}>
            <option value="">All</option>
            <option value="PII">PII</option>
            <option value="JAILBREAK">JAILBREAK</option>
            <option value="TOXICITY">TOXICITY</option>
            <option value="OTHER">OTHER</option>
          </select>
        </div>
        <div className="flex-1" />
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-xs text-neutral-600">Test prompt (action interne)</label>
            <input className="border rounded px-2 py-1 w-96" value={testPrompt} onChange={(e)=> setTestPrompt(e.target.value)} />
          </div>
          <button className="border rounded px-3 py-1" onClick={handleTest} disabled={testLoading}>{testLoading ? '...' : 'Tester'}</button>
        </div>
      </div>
      {testResult && (
        <div className="border rounded-md p-3 mb-4 bg-gray-50 text-sm">
          <div className="font-semibold mb-1">Résultat test</div>
          <pre className="whitespace-pre-wrap">{JSON.stringify(testResult, null, 2)}</pre>
        </div>
      )}
      <div className="border rounded-md">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="p-2">Date</th>
              <th className="p-2">Decision</th>
              <th className="p-2">Risks</th>
              <th className="p-2">Model</th>
              <th className="p-2">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {logs?.map((l:any)=> (
              <tr key={l.id} className="border-t">
                <td className="p-2">{new Date(l.createdAt).toLocaleString()}</td>
                <td className="p-2">{l.decision}</td>
                <td className="p-2">{(l.riskTypes||[]).join(', ')}</td>
                <td className="p-2">{l.model ?? '-'}</td>
                <td className="p-2">{l.totalTokens ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatCard({ title, value }: { title: string; value: number | string }) {
  return (
    <div className="border rounded-md p-4">
      <div className="text-sm text-gray-600">{title}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  )
}


