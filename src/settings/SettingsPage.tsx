import { useQuery, upsertProviderCred, deleteProviderCred, listApiTokens, createApiToken, revokeApiToken } from 'wasp/client/operations'
import { getProviderCreds } from 'wasp/client/operations'
import { useState } from 'react'
import { Button } from '../shared/components/Button'

export function SettingsPage() {
  const { data: creds, refetch } = useQuery(getProviderCreds, {})
  const { data: tokens, refetch: refetchTokens } = useQuery(listApiTokens, {})
  const [newToken, setNewToken] = useState<string | null>(null)
  const [provider, setProvider] = useState('openai')
  const [keyPlain, setKeyPlain] = useState('')
  const [scope] = useState<'global'|'user'>('user')

  async function handleSave() {
    if (!keyPlain) return
    await upsertProviderCred({ provider, keyPlain, scope })
    setKeyPlain('')
    await refetch()
  }

  async function handleDelete(id: string) {
    await deleteProviderCred({ id })
    await refetch()
  }

  async function handleCreateToken() {
    const name = prompt('Nom du token:')
    if (!name) return
    const res = await createApiToken({ name })
    await refetchTokens()
    setNewToken(res.token)
  }

  async function handleRevoke(id: string) {
    await revokeApiToken({ id })
    await refetchTokens()
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Paramètres</h1>
      {newToken && (
        <div className="border rounded-md p-4 mb-6 bg-amber-50">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <div className="text-sm font-semibold mb-1">Votre nouveau token (copiez-le et conservez-le) :</div>
              <input
                className="border rounded px-2 py-1 w-full font-mono text-sm"
                readOnly
                value={newToken}
                onFocus={(e)=> e.currentTarget.select()}
              />
            </div>
            <Button
              onClick={async ()=> { try { await navigator.clipboard.writeText(newToken); } catch { /* ignore */ } }}
            >Copier</Button>
          </div>
          <div className="text-xs text-neutral-600 mt-2">Ce token ne s’affichera plus après avoir quitté ou actualisé cette page.</div>
        </div>
      )}
      <div className="border rounded-md p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-neutral-600">Provider</label>
            <select className="border rounded px-2 py-1 w-full" value={provider} onChange={(e)=> setProvider(e.target.value)}>
              <option value="openai">OpenAI</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-neutral-600">API Key</label>
            <input className="border rounded px-2 py-1 w-full" type="password" value={keyPlain} onChange={(e)=> setKeyPlain(e.target.value)} placeholder="sk-..." />
          </div>
          {/* Portée forcée à Utilisateur côté serveur et client */}
        </div>
        <div className="mt-4">
          <Button onClick={handleSave}>Enregistrer</Button>
        </div>
      </div>

      <h2 className="text-lg font-semibold mb-2">Clés enregistrées</h2>
      <div className="border rounded-md">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="p-2">Provider</th>
              <th className="p-2">Portée</th>
              <th className="p-2">Créé le</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {creds?.map((c:any)=> (
              <tr key={c.id} className="border-t">
                <td className="p-2">{c.provider}</td>
                <td className="p-2">{c.userId ? 'Utilisateur' : 'Globale'}</td>
                <td className="p-2">{new Date(c.createdAt).toLocaleString()}</td>
                <td className="p-2 text-right">
                  <Button variant="ghost" onClick={()=> handleDelete(c.id)}>Supprimer</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Tokens API</h2>
          <Button onClick={handleCreateToken}>Nouveau token</Button>
        </div>
        <div className="border rounded-md">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="p-2">Nom</th>
                <th className="p-2">Créé le</th>
                <th className="p-2">Statut</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {tokens?.map((t:any)=> (
                <tr key={t.id} className="border-t">
                  <td className="p-2">{t.name}</td>
                  <td className="p-2">{new Date(t.createdAt).toLocaleString()}</td>
                  <td className="p-2">{t.revokedAt ? 'Révoqué' : 'Actif'}</td>
                  <td className="p-2 text-right">
                    {!t.revokedAt && (
                      <Button variant="ghost" onClick={()=> handleRevoke(t.id)}>Révoquer</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}


