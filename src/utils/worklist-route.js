// src/utils/worklist-route.js
// Where an address from before worklists belonged to projects now goes.
//   #retainers/<companyId>  a client's worklist (and what emails already sent
//                           link to) → that company's project, its retainer
//                           first; with no project yet, the project list
//   #retainers              → the project list
// Anything else is not ours: null.

export function legacyRetainersTarget(hash, projects = []) {
  const [view, id] = String(hash).replace(/^#/, '').split('/')
  if (view !== 'retainers') return null
  const mine = id ? projects.filter(p => p.company_id === id) : []
  const project = mine.find(p => p.is_retainer) ?? mine[0]
  return project ? { hash: `#projects/${project.id}/worklist`, found: true } : { hash: '#projects', found: false }
}
