---
name: meeting-notes
description: Turning raw meeting notes, a transcript, or a chat log into a clean structured record — decisions, action items with owners and deadlines.
---

# Turning raw notes into a meeting record

The user has something messy — typed-along notes, a transcript export, a chat
log — and wants the meeting out of it: what was decided, who does what by when.

## 1. Read the source first

`read_file` the file they point at. If they pasted text instead, work from the
paste. Do not summarize from the file name.

## 2. Extract in this order of importance

1. **Decisions** — anything agreed, approved, or rejected. Quote the wording
   when the exact phrasing matters (amounts, dates, names).
2. **Action items** — each with an owner and a deadline. When the notes name
   no owner or date, write `(담당 미정)` or `(기한 미정)` — never invent one.
3. **Open questions** — raised but not settled.
4. A three-line summary at the top, written last.

Everything else in the notes — greetings, tangents, scheduling chatter — is
deliberately dropped. If something seems important but unclear, put it under
open questions rather than guessing.

## 3. Write the record to a new file

Save next to the source as `<원본이름>-정리.md` — never overwrite the raw
notes; they are the only evidence of what was actually said. Use the language
the notes are in.

```
# 회의록: <제목> (<날짜>)

## 요약
## 결정사항
## 할 일
- [ ] <일> — <담당>, <기한>
## 미결 사항
```

## 4. Offer the follow-ups they usually want next

After showing the record: offer to save the key facts to the knowledge base
(`knowledge_save` — one note for the meeting, linked to project notes), and to
draft a share-ready message version if they need to send it to attendees.
