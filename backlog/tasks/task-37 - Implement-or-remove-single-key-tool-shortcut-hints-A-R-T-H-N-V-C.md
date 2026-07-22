---
id: TASK-37
title: Implement or remove single-key tool shortcut hints (A/R/T/H/N/V/C)
status: To Do
assignee: []
created_date: '2026-07-22 17:13'
labels: []
dependencies: []
priority: low
ordinal: 54000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Review finding (round 11): toolbar button titles advertise single-letter shortcuts but no plain-letter keydown handler exists anywhere — the hints are misleading. Either implement the shortcuts (gated on isTypingTarget) or drop the letters from the titles. Pre-existing issue, not introduced by TASK-36.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every shortcut shown in a tooltip actually works, or is no longer shown
<!-- AC:END -->
