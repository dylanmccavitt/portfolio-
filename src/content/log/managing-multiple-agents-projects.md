---
title: managing multiple agents & projects
date: 2026-04-17
subtitle: codex, claude, linear & a little bit of context management and prompting
draft: false
---

This is the simplest way that **I** have been handling multiple agents and projects in parallel. 

#### i.  

I connect Codex and Claude Code to Linear MCP. Each project gets broken into phases/tracks, and every track gets broken into issues. 

![](/log/uploads/pasted-image-1776447185394.png)

#### ii. 

Before I send any issue, it has to be clear enough to execute. I make sure it has scope, constraints, non-goals, acceptance criteria, and a quick test plan. I also use the same issue template every time. That alone cuts down a lot of confusion and rework. 

#### iii. 

From there, I delegate work by strengths. In my setup right now, Codex is handling most, if not all,  non-UI tasks, while Claude handles UI-heavy tasks. Each issue gets its own worktree and branch for full isolation. I mark dependencies as non-blocking wherever possible so I can run multiple issues in parallel.

![](/log/uploads/pasted-image-1776453951207.png)

#### iv. 

When an agent (or subagent) finishes a task, it opens a PR and links it back to Linear. I tend to keep PRs small (around under \~500 changed lines) so review quality stays high. Then I do the real work: review every changed line, run checks,  validate, and either merge or send it back with specific feedback.

![](/log/uploads/pasted-image-1776449260475.png)

#### v. 

Before anything gets merged, I run typechecks, tests, and lint, then require green CI on latest `main`. My review is also generally based on risk. So a quicker pass for low-risk changes, and deeper passes for things like auth, data models, migrations, infra, and shared components. 

![](/log/uploads/pasted-image-1776450830087.png)

#### vi. 

One of the most important parts of this flow is what happens after an issue is marked done. I started keeping explicit instructions in agent.md, claude.md, and shared skills so everything is consistent across projects. I also reset session between issues unless the next task is small and closely related. Fresh sessions keep context clean and reduce drift.  

#### vii. 

Lastly, I treat each returned PR as training data for my process. If something goes wrong, I update prompts/skills so the same mistake is less likely next time. I also started tracking metrics weekly, especially first pass merge rate, so I can see if quality is actually improving.  

#### viii. 

This workflow seems tedious, and honestly, parts of it are. But as coding agents keep improving, I've found this structure to be worth investing in. I don't think the goal is to remove human judgment, but to build a repeatable system where speed from agents and quality review can coexist. To me, that feels less like a temporary process and more like the future of being a software engineer.  

### some workflow metrics 

small sample 3-day snapshot (14 merged agent PRs):

- first-pass merge rate: \*\*79%\*\* (11/14)
- rework rate: \*\*21%\*\* (3/14)
- median PR turnaround (opened → merged): \*\*22 minutes\*\*
- parallel throughput: \*\*typically 1–2 issues in parallel, peak 5\*\*
