# Studious — Phase 0 Research Report

Date: 2026-11-16

## Method and limits (read first)

- Tools: web search only. Direct fetches of official pages (`support.google.com`, `docs.ankiweb.net`, `www.turbolearn.ai`) failed with DNS errors because the sandbox network blocks them. Nothing was read straight from a vendor page.
- Confidence labels: **[Official-snippet]** = the search result surfaced Google/Anki/RemNote's own page text. **[Secondary]** = third-party blog, review or aggregator. **[Unverified]** = single-source, conflicting, or marketing-only. No hands-on testing of any product was possible.
- Reddit: the search returned no actual Reddit threads. The "Reddit consensus" below comes from one blog summarising Reddit and is **[Unverified]**.
- Names: several 2026 sources say NotebookLM is now "Gemini Notebook" and TurboLearn is now "Turbo AI". The TurboLearn rebrand appears in several sources (App Store listing titled "Turbo AI"). The NotebookLM rename **[Unverified]**.

## 1. Products investigated

Primary: Google NotebookLM, TurboLearn AI / Turbo AI.
Secondary: Quizlet, Anki, RemNote, Knowt, StudyFetch, Perplexity, Elicit, SciSpace.
Depth is uneven: NotebookLM, Anki, RemNote, Turbo got real search coverage. Perplexity, Elicit, SciSpace only got a single comparison query.

## 2. Findings by product

### NotebookLM
- Source limits: Google's upgrade page lists 50 sources/notebook (free) and higher tiers at 100/300/500; FAQ says up to 500,000 words per source. **[Official-snippet]**. A 200 MB file cap is **[Secondary]**.
- Studio outputs named by multiple guides: slide decks, infographics, mind maps, reports, flashcards, quizzes, data tables (plus audio/video, which we exclude). **[Secondary]**
- Mind maps are launched from the chat as a chip and saved as a note. **[Secondary, single source]**
- Quizzes: roughly ten questions, topic/difficulty customisable. **[Secondary]**
- Data tables: user defines columns, tool fills rows from sources. The "94% accuracy" figure is **[Unverified]**.
- Slide decks export to PDF/PPTX; reports to Google Docs. Flashcard/quiz export reported as absent ("share by link or copy") but sources conflict. **[Secondary / conflicting]**
- Gap named by reviewers: no scheduled flashcard review or interval tracking; rough on phones. **[Secondary]**

### TurboLearn AI / Turbo AI
- Turns audio, video, text and PDFs into notes, quizzes, flashcards; has chat over content. **[Secondary]**
- Pricing and quotas conflict across sources (e.g. $5.99–$8.99/mo with 15 lecture hours, 50 quizzes, 200 chat messages vs $14.99/mo or $59.99/yr). Treat all numbers as **[Unverified]**.
- Complaints: slow processing, limited free tier, limited customisation, variable accuracy, weak long-term review scheduling. **[Secondary]**
- One hands-on review: a quiz scored 67% on first attempt. Anecdote only.

### Anki
- FSRS toggle is global; parameters and desired retention are per preset; start with defaults for a few weeks. **[Official-snippet via search]**
- Known strengths from background knowledge, not verified this session: four-button grading, learning steps, new-cards/day limits, fuzz and load balancing. **[Unverified here]**

### RemNote
- Create a card by typing `==` inline; built-in spaced repetition; exam-date-based scheduling; PDF highlight and margin notes linked to the knowledge base; cards stay editable after AI generation from PDFs. **[Official-snippet]**
- Whether PDF annotation is free conflicts between RemNote's FAQ and an aggregator. **[Conflicting]**

### Knowt
- Free tier with AI flashcards and practice questions, daily AI-notes cap; SM-2 and FSRS (beta) scheduling. **[Secondary]**

### Quizlet
- Flashcards, Learn mode, practice tests, match games; strongest AI features (Magic Notes, Q-Chat) paywalled. **[Secondary]**

### StudyFetch
- Tutor (Spark.E) grounded in uploaded course material, text and voice; paid tiers gate the best features. Voice/video excluded for us. **[Secondary]**

### Perplexity / Elicit / SciSpace
- Perplexity: web-search answer engine with inline citations. Elicit and SciSpace: structured extraction tables and per-paper comparison; claims of "closer to source" come from a comparison blog. **[Secondary]**

## 3. Competitive feature matrix

Legend: E = Essential, H = High value, O = Optional, X = Excluded.

| Capability | NotebookLM | Turbo | Anki | RemNote | Knowt/Quizlet | Elicit/SciSpace | Ours |
|---|---|---|---|---|---|---|---|
| Notebook/workspace organisation | yes | partial | decks | docs graph | sets/folders | projects | E |
| Multi-source upload (PDF, text, URL, paste) | yes | yes | no | PDF | yes | papers | E |
| Grounded chat with citations | yes | yes | no | limited | tutor | yes | E |
| Click citation → highlighted passage | yes (reported) | unverified | no | no | no | partial | E |
| Generated study guide / report | yes | notes | no | no | notes | summary | E |
| Flashcards | yes | yes | yes | yes | yes | no | E |
| Spaced repetition scheduling | no | weak | FSRS | yes | SM-2/FSRS | no | E (FSRS) |
| Quizzes with explanations | yes | yes | no | yes | yes | no | E |
| Mind map | yes | unverified | no | graph | no | no | E |
| Slide deck | yes | no | no | no | no | no | E |
| Data table extraction | yes | no | no | no | no | yes | E |
| Glossary | no | unverified | no | no | no | no | E |
| Editable notes | saved notes | yes | edit cards | core | yes | no | E |
| Analytics / mastery | no | basic | stats | stats | basic | no | H |
| Cross-notebook search | limited | unverified | browse | yes | yes | yes | H |
| Export | partial | unverified | apkg | yes | partial | CSV | E |
| Audio, podcast, voice, video | yes | yes | no | no | no | no | X |

## 4. Strongest UX patterns worth adopting

1. Three-pane workspace (sources / conversation / outputs) with each pane collapsible. Keeps provenance visible while working.
2. Citations as first-class objects: a numbered mark in chat that opens the source at the exact passage with highlight.
3. Studio outputs saved as persistent items (not ephemeral chat), regenerable, editable.
4. Anki-style four-grade review with predicted next interval shown on each button.
5. RemNote's "cards stay editable after generation" and exam-date-based scheduling.
6. Elicit-style user-defined columns for extraction tables.

## 5. Gaps in existing products

- NotebookLM has no real retention loop; flashcards are not scheduled.
- Turbo/Knowt/Quizlet generate quickly but ground weakly and rarely show where a claim came from.
- Nobody links a wrong quiz answer back to the exact source passage and to a review card automatically.
- Little transparency on what the model could not find in the sources ("not covered by your sources" is rarely first-class).
- Export of study artefacts (cards, quizzes) is inconsistent.

Opportunity: one product that is source-grounded like NotebookLM AND has a real FSRS review loop AND closes the loop from quiz misses to cards to source passages.

## 6. Selected features

Essential: notebooks, source management (PDF/text/Markdown/URL paste/pasted text), reader with highlight, grounded chat with interactive citations and an explicit "not found in sources" state, eight Studio modules, FSRS review, editable outputs, search, export, light and dark themes, keyboard access, responsive layout.
High value: mastery analytics, quiz-miss → card pipeline, per-notebook learning preferences, difficulty adaptation, exam-date scheduling.
Optional: Anki `.apkg` export, spreadsheet-style table editing.
Excluded: audio, podcasts, voice, speech, video.

## 7. Eight Studio modules (INFERRED — see blocker)

The prompt refers to "eight Studio modules" but the module list was not included. Working assumption, matching the Phase 0 matrix: 1 Study Guide/Report, 2 Flashcards, 3 Quiz, 4 Mind Map, 5 Slide Deck, 6 Data Table, 7 Glossary, 8 Notes. Needs confirmation.

## 8. Proposed architecture

- Vite + React + TypeScript, client-only, local-first.
- IndexedDB via Dexie for notebooks, sources (with chunk index), chat, studio items, review state.
- Ingestion: pdf.js text extraction per page, chunking with page/offset anchors so citations resolve to a precise span.
- Retrieval: BM25-style local index (MiniSearch) over chunks; no embeddings needed for v1.
- AI layer: provider interface (`generate(prompt, context) → structured JSON`) with (a) a bring-your-own-key adapter and (b) a deterministic offline extractive adapter so the app is fully usable and testable with no key. Every generated claim carries `chunkId` citations; unsupported claims are rejected.
- Scheduling: `ts-fsrs`.
- Export: Markdown, JSON, CSV (cards, tables), PDF (print stylesheet), PPTX (pptxgenjs), Anki-compatible TSV.
- Mind map: SVG layout rendered in-app.

## 9. Visual direction

Own identity, not a NotebookLM clone: "annotated manuscript". Warm paper neutrals, deep ink-green accent, serif display for headings and reader, clean sans for UI, citations styled as footnote-style superscripts with marginal highlights. Dense but calm; hairline borders before shadows; 4/8pt spacing; AA contrast in both themes; reduced-motion honoured.

## 10. Implementation priorities

1. Data model + ingestion + citation anchoring.
2. Three-pane shell, source reader.
3. Grounded chat with interactive citations.
4. Studio modules (Guide, Flashcards, Quiz first; then Map, Deck, Table, Glossary, Notes).
5. FSRS review + analytics.
6. Search, export, polish, accessibility pass, tests.

## Sources (search-result pages; none read directly)

- NotebookLM FAQ: https://support.google.com/notebooklm/answer/16269187?hl=en
- NotebookLM plans/limits: https://support.google.com/notebooklm/answer/16213268?hl=en
- Studio overview guides: https://www.monash.edu/student-academic-success/enhance-digital-capabilities/master-online-learning-systems/notebooklm/study-tools-and-exam-preparation , https://notebooklm-guide.com/studio-command-center/ , https://www.jeffsu.org/notebooklm-changed-completely-heres-what-matters-in-2026/
- Limits (third party): https://elephas.app/blog/notebooklm-source-limits , https://fast.io/resources/notebooklm-max-sources/
- Turbo AI: https://hyscaler.com/insights/discover-turbolearn-ai/ , https://apps.apple.com/us/app/-/id6502794561 , https://mspoweruser.com/turbolearn-ai-review
- Comparisons: https://scholarly.so/blog/best-ai-for-studying-reddit-2026 , https://sourceforge.net/software/compare/Knowt-vs-Turbo-AI
- Anki deck options: https://docs.ankiweb.net/deck-options.html
- RemNote: https://www.remnote.com/pdf_to_cards , https://www.remnote.com/blog/how-to-turn-notes-into-flashcards , https://www.remnote.com/blog/studyfetch-vs-quizlet-vs-remnote
- Quizlet/Knowt/StudyFetch: https://toolradar.com/compare/study-fetch-vs-knowt , https://creati.ai/ai-tools/studyfetch-com/alternatives/study-fetch-vs-quizlet-comparison-features-pricing-performance
- Research tools: https://scispace.com/compare/elicit , https://aitoolsatlas.ai/compare/elicit-vs-perplexity

---

## 11. Phase 1 reconciliation — what was built, and where it differs

The Phase 1 specification referenced in the brief did not arrive with the prompt. The build follows the inferred specification in sections 6–8, confirmed by the requester. If the real specification differs (module list, data model, export formats), that is the first thing to reconcile.

**Built (all verified in a real browser and/or unit tests):**
- Notebooks (library with due counts, backup import/export), three-pane workspace, responsive down to 390 px with a tab bar.
- Source management: PDF (pdf.js, page-aware), Markdown, text, HTML, pasted text; per-source on/off toggle that genuinely changes what answers can use; reader with find and page markers.
- Grounded chat with interactive citations: every sentence carries chunk-level citations; hover previews the passage; click opens the source scrolled to the exact cited sentence (falls back to the whole passage if a model paraphrased). An explicit "not covered by your sources" state replaces guessing. Pronoun follow-ups reuse the previous question. Answers can be saved to notes.
- Eight Studio modules: study guide, flashcards, quiz (adaptive difficulty from past results), mind map (pan/zoom/collapse), slide deck (edit, present, PPTX), data table (user-defined columns, per-source or per-term rows, editable cells, honest "not found" cells), glossary (definitions and formulas), notes (editable). Items are saved, renamable, regenerable.
- Learning loop: FSRS scheduling (ts-fsrs) with interval previews on the four grade buttons, undo, per-notebook target retention, new-cards-per-day cap, exam-date clamping; quiz misses can be added to the review deck with a link back to the source passage; glossary terms can become cards.
- Progress: card-state breakdown, 14-day review history, 7-day forecast, streak, estimated recall, true retention, mastery by source, quiz accuracy.
- Global search (⌘/Ctrl-K) across passages, Studio items and cards in every notebook.
- Export: Markdown with footnoted citations, print/PDF, CSV (cards, tables, glossary), Anki-importable TSV, quiz JSON, mind-map SVG, PPTX, full-notebook JSON backup.
- Accessibility: automated axe audit clean on the main screens in both themes; keyboard operation for quiz, review, mind map, dialogs; reduced-motion respected.

**Honest limits:**
- **Offline mode is extractive.** Without an API key, answers and Studio items are ranked, quoted passages — dependable and private, but not paraphrased, and term/definition extraction is a heuristic tuned for English prose.
- **The optional model path was tested only against a mocked API**, never a live provider (this sandbox has no outbound access to one). Its contract is covered by tests: invented citations are dropped, unusable output is rejected, failures fall back to offline with a visible notice.
- Not built: OCR for scanned PDFs, URL/YouTube/DOCX import, `.apkg` export, cross-device sync, collaboration. Audio, podcast, voice and video are excluded by design.
- Large-document performance was not stress-tested beyond small PDFs and the sample notebook.
- Competitor findings in sections 2–5 remain search-snippet level and were not hands-on verified.

## 12. UI revision (requested after the first build)

The interface was reworked to follow the screenshots supplied by the requester (Turbo AI's home and workspace, StudyFetch's tile grid): dark-first theme with purple accents, a "What do you want to learn?" home with an upload/paste prompt and a lessons list, an icon rail, a document pane beside a chat pane with Quizzes/Flashcards quick cards, and colour-coded study-tool tiles. The mascot is an original drawing, not a copy of either product's artwork. Record and YouTube entry points were deliberately not included (audio/video are excluded). A "New folder" control was not built.
