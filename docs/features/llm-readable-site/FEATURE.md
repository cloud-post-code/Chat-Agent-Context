# Feature — LLM-readable site: llms.txt, Markdown, and an open door for AI crawlers

## Why

ChatGPT and Claude reach a website two ways: a crawler fetches pages ahead of
time (GPTBot, OAI-SearchBot, ClaudeBot, Claude-SearchBot), or the assistant
fetches a URL on a user's behalf mid-conversation (ChatGPT-User, Claude-User).
Both hit a chat box: the agent page is a React client that renders nothing
useful without JavaScript, and everything the owner curated — profile,
services, menu, projects, approved answers, sources — is reachable only by
asking the model. An LLM that lands here learns almost nothing.

The convention these assistants have converged on is `llms.txt`
(https://llmstxt.org): a Markdown index at the site root naming what the site
is and linking to Markdown versions of its content, with `llms-full.txt`
carrying the whole thing in one fetch. Alongside it, `robots.txt` must not
block the AI user agents, and a page asked for as `text/markdown` should answer
in Markdown.

## Summary

Every tenant's curated knowledge is published as Markdown built for an LLM to
read, discoverable from the standard places, with the crawlers explicitly
welcomed and the assistant's own transports (chat API, A2A) named so an agent
can also *talk* to the site.

## Desired Behavior

- **Per-tenant index** at `/a/<slug>/llms.txt`: H1 name, a blockquote summary
  (tagline or a one-line description), what the business is, and links to the
  full document, the chat page, the chat API and — for the founding tenant —
  the A2A card. Follows the llms.txt format exactly (H1, blockquote, H2
  sections of `- [title](url): note` lines, optional `## Optional`).
- **Per-tenant full document** at `/a/<slug>/llms-full.txt`: everything the
  chatbot would tell a visitor, as Markdown sections in a fixed order: About,
  Contact & hours, Services, Menu (with prices as the site states them),
  Projects, Frequently asked questions (enabled approved answers with text),
  Sources (scanned knowledge sources: title, link, summary), Booking (whether
  on and the questions asked), and How to talk to this agent. Empty sections
  are omitted; nothing is invented; nothing from admin-only surfaces
  (directives, corrections, activity, orders) appears.
- **Platform index** at `/llms.txt` naming every agent on the deployment with
  a link to each one's index and full document; `/llms-full.txt` concatenates
  every tenant's full document.
- **Markdown negotiation**: `GET /a/<slug>` with `Accept: text/markdown` (or
  `/a/<slug>.md`) serves the full document; `GET /` with `Accept:
  text/markdown` serves the platform index. HTML requests are untouched.
- **Discoverable**: `robots.txt` names GPTBot, OAI-SearchBot, ChatGPT-User,
  ClaudeBot, Claude-User, Claude-SearchBot and anthropic-ai with `Allow: /`,
  disallows `/admin`, `/api/admin` and `/signup` for everyone, and points at
  the sitemap. `sitemap.xml` lists the directory, every agent page and every
  llms file. The agent page's `<head>` carries `<link rel="alternate"
  type="text/markdown">` to its full document. The `/agent` page lists the
  new files.
- Responses are `text/markdown; charset=utf-8`, cacheable for five minutes
  with an ETag, and CORS-open like the agent card.

## Non-Goals

- No new MCP server; the A2A endpoints and chat API remain the transports.
- No raw dumps of source text; sources contribute title, link and summary.
- Custom domains (pending features) — links use the platform origin.
