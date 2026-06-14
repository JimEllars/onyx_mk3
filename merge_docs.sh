#!/bin/bash
mkdir -p docs
cat REVIEW.md REVIEW_APP.md REVIEW_PLAN.md REVIEW_PLAN_NEXT.md REVIEW_AND_PLAN.md REVIEW_APP_PLAN.md REVIEW_COMPLETED.md ROADMAP.md SPRINT_UPDATE.md > docs/temp.md 2>/dev/null
git rm REVIEW*.md ROADMAP.md SPRINT_UPDATE.md 2>/dev/null
