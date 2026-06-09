import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { Anthropic } from '@anthropic-ai/sdk'

export type Env = {
  DB: D1Database
  ANTHROPIC_API_KEY: string
}

const app = new Hono<{ Bindings: Env }>()

// Enable CORS so the frontend can call this API
app.use('/*', cors())

// ── Helpers ──────────────────────────────────────────────────────────────────
// Helper to get nested company and contact names for Opportunities and Placements
async function enrichWithRelations(c: any, items: any[]) {
  if (!items.length) return items;
  
  // Very simplistic "JOIN" in memory for speed (in a real scenario, use actual SQL JOINs)
  const { results: contacts } = await c.env.DB.prepare(`SELECT id, name, firstName, lastName, mobilePhone FROM contacts`).all()
  const { results: companies } = await c.env.DB.prepare(`SELECT id, name FROM companies`).all()
  const { results: recruiters } = await c.env.DB.prepare(`SELECT id, name FROM people`).all()

  const contactMap = new Map(contacts.map((x: any) => [x.id, x]))
  const companyMap = new Map(companies.map((x: any) => [x.id, x]))
  const recruiterMap = new Map(recruiters.map((x: any) => [x.id, x]))

  return items.map(item => {
    const contact = contactMap.get(item.contactId || item.kandidaat)
    const recruiter = recruiterMap.get(item.recruiterId || item.eigenaar)
    const company = companyMap.get(item.accountId || item.clientId || item.organisatieId)
    
    const fixEncoding = (str: string | undefined) => str ? str.replace(/Brnos/g, 'Bérénos').replace(/B.r.nos/g, 'Bérénos') : str;

    return {
      ...item,
      client: company?.name || item.client || item.organisatie,
      contactNaam: contact ? fixEncoding(contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(' ')) : undefined,
      contactMobiel: contact?.mobilePhone,
      recruiterNaam: fixEncoding(recruiter?.name) || item.eigenaar,
      eigenaar: fixEncoding(recruiter?.name) || item.eigenaar,
      kandidaat: contact ? fixEncoding(contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(' ')) : item.kandidaat,
      organisatie: company?.name || item.organisatie,
      companyName: company?.name
    }
  })
}

// Helper for wrapping handlers in try-catch
const withErrorHandling = (handler: any) => async (c: any) => {
  try {
    return await handler(c)
  } catch (e: any) {
    console.error(e)
    return c.json({ error: e.message || 'Internal Server Error' }, 500)
  }
}

// ── Opportunities ─────────────────────────────────────────────────────────
app.get('/api/opportunities', withErrorHandling(async (c: any) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM opportunities ORDER BY aanmaakdatum DESC`).all()
  const enriched = await enrichWithRelations(c, results)
  return c.json(enriched)
}))

app.post('/api/opportunities', withErrorHandling(async (c: any) => {
  const body = await c.req.json()
  const id = "o" + Date.now()
  await c.env.DB.prepare(`
    INSERT INTO opportunities (
      id, aanmaakdatum, title, werklocatie, ondertitel, memo, client, clientId, 
      endClient, contactId, recruiterId, status, startDate, durationMonths, 
      hoursPerWeek, ratePerHour, deadline, endDate, vacatureNummer, recordType, 
      doorlooptijdStart, doorlooptijdDagen, prioriteit, extraContact, rolContact, 
      extraRecruiter, aantalInschrijvingen, datumVanWijziging, intro, werkzaamheden
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, body.aanmaakdatum, body.title, body.werklocatie, body.ondertitel, body.memo, body.client, body.clientId,
    body.endClient, body.contactId, body.recruiterId, body.status, body.startDate, body.durationMonths,
    body.hoursPerWeek, body.ratePerHour, body.deadline, body.endDate, body.vacatureNummer, body.recordType,
    body.doorlooptijdStart, body.doorlooptijdDagen, body.prioriteit, body.extraContact, body.rolContact,
    body.extraRecruiter, body.aantalInschrijvingen, body.datumVanWijziging, body.intro, body.werkzaamheden
  ).run()
  return c.json({ id, ...body }, 201)
}))

app.delete('/api/opportunities/:id', withErrorHandling(async (c: any) => {
  const id = c.req.param('id')
  await c.env.DB.prepare(`DELETE FROM opportunities WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
}))

// ── Placements ────────────────────────────────────────────────────────────
app.get('/api/placements', withErrorHandling(async (c: any) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM placements ORDER BY startDate DESC`).all()
  const enriched = await enrichWithRelations(c, results)
  return c.json(enriched)
}))

app.post('/api/placements', withErrorHandling(async (c: any) => {
  const body = await c.req.json()
  const id = "pl" + Date.now()
  await c.env.DB.prepare(`
    INSERT INTO placements (
      id, eigenaar, plaatsingId, verwachteEinddatum, kandidaat, mobielKandidaat, 
      organisatie, organisatieId, eindklant, contactId, functie, uren, tarief, 
      inkoopTarief, notitie, werklocatie, status, startDate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, body.eigenaar, body.plaatsingId, body.verwachteEinddatum, body.kandidaat, body.mobielKandidaat,
    body.organisatie, body.organisatieId, body.eindklant, body.contactId, body.functie, body.uren, body.tarief,
    body.inkoopTarief, body.notitie, body.werklocatie, body.status, body.startDate
  ).run()
  return c.json({ id, ...body }, 201)
}))

app.delete('/api/placements/:id', withErrorHandling(async (c: any) => {
  const id = c.req.param('id')
  await c.env.DB.prepare(`DELETE FROM placements WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
}))

// ── Contacts ──────────────────────────────────────────────────────────────
app.get('/api/contacts', withErrorHandling(async (c: any) => {
  const { results } = await c.env.DB.prepare(`
    SELECT *, COALESCE(NULLIF(name, ''), trim(COALESCE(firstName, '') || ' ' || COALESCE(lastName, ''))) AS name 
    FROM contacts 
    ORDER BY name ASC
  `).all()
  const enriched = await enrichWithRelations(c, results)
  return c.json(enriched)
}))

app.post('/api/contacts', withErrorHandling(async (c: any) => {
  const body = await c.req.json()
  const id = "c" + Date.now()
  const name = `${body.firstName || ''} ${body.lastName || ''}`.trim()
  await c.env.DB.prepare(`
    INSERT INTO contacts (id, firstName, lastName, name, title, mobilePhone, phone, email, linkedinUrl, accountId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, body.firstName, body.lastName, name, body.title, body.mobilePhone, body.phone, body.email, body.linkedinUrl, body.accountId).run()
  return c.json({ id, name, ...body }, 201)
}))

app.put('/api/contacts/:id', withErrorHandling(async (c: any) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const name = `${body.firstName || ''} ${body.lastName || ''}`.trim()
  await c.env.DB.prepare(`
    UPDATE contacts SET firstName=?, lastName=?, name=?, title=?, mobilePhone=?, phone=?, email=?, linkedinUrl=?, accountId=? WHERE id=?
  `).bind(body.firstName, body.lastName, name, body.title, body.mobilePhone, body.phone, body.email, body.linkedinUrl, body.accountId, id).run()
  return c.json({ id, name, ...body })
}))

app.delete('/api/contacts/:id', withErrorHandling(async (c: any) => {
  const id = c.req.param('id')
  await c.env.DB.prepare(`DELETE FROM contacts WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
}))

// ── Companies ─────────────────────────────────────────────────────────────
app.get('/api/companies', withErrorHandling(async (c: any) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM companies ORDER BY name ASC`).all()
  return c.json(results)
}))

app.post('/api/companies', withErrorHandling(async (c: any) => {
  const body = await c.req.json()
  const id = "comp" + Date.now()
  await c.env.DB.prepare(`
    INSERT INTO companies (id, name, phone, website, billingCity, billingStreet, billingPostalCode, billingCountry, industry, sector, type, kvkNummer, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, body.name, body.phone, body.website, body.billingCity, body.billingStreet, body.billingPostalCode, body.billingCountry, body.industry, body.sector, body.type, body.kvkNummer, body.description).run()
  return c.json({ id, ...body }, 201)
}))

app.put('/api/companies/:id', withErrorHandling(async (c: any) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  await c.env.DB.prepare(`
    UPDATE companies SET name=?, phone=?, website=?, billingCity=?, billingStreet=?, billingPostalCode=?, billingCountry=?, industry=?, sector=?, type=?, kvkNummer=?, description=? WHERE id=?
  `).bind(body.name, body.phone, body.website, body.billingCity, body.billingStreet, body.billingPostalCode, body.billingCountry, body.industry, body.sector, body.type, body.kvkNummer, body.description, id).run()
  return c.json({ id, ...body })
}))

app.delete('/api/companies/:id', withErrorHandling(async (c: any) => {
  const id = c.req.param('id')
  await c.env.DB.prepare(`DELETE FROM companies WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
}))

// ── People ────────────────────────────────────────────────────────────────
app.get('/api/people', withErrorHandling(async (c: any) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM people ORDER BY name ASC`).all()
  return c.json(results)
}))

app.post('/api/people', withErrorHandling(async (c: any) => {
  const body = await c.req.json()
  const id = "p" + Date.now()
  await c.env.DB.prepare(`
    INSERT INTO people (id, name, category, email, phone) VALUES (?, ?, ?, ?, ?)
  `).bind(id, body.name, body.category, body.email, body.phone).run()
  return c.json({ id, ...body }, 201)
}))

app.delete('/api/people/:id', withErrorHandling(async (c: any) => {
  const id = c.req.param('id')
  await c.env.DB.prepare(`DELETE FROM people WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
}))

// ── Timeline ──────────────────────────────────────────────────────────────
app.get('/api/timeline', withErrorHandling(async (c: any) => {
  const contactId = c.req.query('contactId')
  const opportunityId = c.req.query('opportunityId')
  const companyId = c.req.query('companyId')

  let query = `SELECT * FROM timeline`
  let params: any[] = []

  if (contactId) { query += ` WHERE contactId = ?`; params.push(contactId); }
  else if (opportunityId) { query += ` WHERE opportunityId = ?`; params.push(opportunityId); }
  else if (companyId) { query += ` WHERE companyId = ?`; params.push(companyId); }
  
  query += ` ORDER BY date DESC`

  const { results } = await c.env.DB.prepare(query).bind(...params).all()
  return c.json(results)
}))

app.post('/api/timeline', withErrorHandling(async (c: any) => {
  const body = await c.req.json()
  const id = "t_" + Math.random().toString(36).substring(7)
  const date = new Date().toISOString()
  
  await c.env.DB.prepare(`
    INSERT INTO timeline (id, contactId, opportunityId, companyId, type, date, summary, user)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, body.contactId || null, body.opportunityId || null, body.companyId || null, 
    body.type, date, body.summary, body.user
  ).run()

  return c.json({ id, date, ...body }, 201)
}))

app.put('/api/timeline/:id', withErrorHandling(async (c: any) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  await c.env.DB.prepare(`
    UPDATE timeline SET summary=? WHERE id=?
  `).bind(body.summary, id).run()
  return c.json({ id, ...body })
}))

app.delete('/api/timeline/:id', withErrorHandling(async (c: any) => {
  const id = c.req.param('id')
  await c.env.DB.prepare(`DELETE FROM timeline WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
}))

// ── LLM Chat Route ────────────────────────────────────────────────────────
app.post('/api/chat', async (c) => {
  try {
    const { messages } = await c.req.json()
    const apiKey = c.env.ANTHROPIC_API_KEY

    if (!apiKey) {
      return c.json({ error: "ANTHROPIC_API_KEY environment variable is missing" }, 400)
    }

    // In a real prod setup with lots of data, you would query the DB dynamically
    // based on the user's input (using function calling or RAG). 
    // For now, to keep it simple and similar to your current setup, we fetch recent state:
    const { results: contacts } = await c.env.DB.prepare(`SELECT * FROM contacts LIMIT 100`).all()
    const { results: opps } = await c.env.DB.prepare(`SELECT * FROM opportunities WHERE status = 'Open' LIMIT 50`).all()
    const { results: timelines } = await c.env.DB.prepare(`SELECT * FROM timeline ORDER BY date DESC LIMIT 100`).all()

    const anthropic = new Anthropic({ apiKey })

    const systemPrompt = `You are Spectux, an AI assistant for the CloudForce portal.
Your primary role is to answer questions about the CRM data (Contacts, Opportunities, Placements, and Timelines).
You MUST ONLY answer questions related to the CRM portal and its data. If asked about outside topics, refuse politely.

Here is the current CRM data in JSON format:
Contacts: ${JSON.stringify(contacts)}
Open Opportunities: ${JSON.stringify(opps)}
Recent Timeline Logs: ${JSON.stringify(timelines)}

Answer questions based on this CRM data clearly and concisely in Dutch.
When asked about the latest update for someone (like Atakan), check the recent timeline logs and opportunities.
When asked about contact history, check the timeline entries.
When asked about status updates, check opportunities and placements.`

    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620", // using standard claude 3.5 sonnet
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages,
    })

    return c.json({ text: (response.content[0] as any).text })
  } catch (error: any) {
    console.error("Chat error:", error)
    return c.json({ error: error.message || "Failed to process chat" }, 500)
  }
})

export default app
