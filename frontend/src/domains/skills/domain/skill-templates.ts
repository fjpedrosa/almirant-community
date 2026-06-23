import type { LucideIcon } from "lucide-react";
import { CheckCircle, Code, FileSearch, FileText, Puzzle } from "lucide-react";

export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  content: string;
}

export const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    id: "validate",
    name: "Validate",
    description: "Review code and run tests for work items",
    icon: CheckCircle,
    content: `# Validate Skill

## Trigger
When work items are moved to the "To Review" column.

## Instructions

1. **Code Review**: Review all changed files for:
   - Code quality and adherence to project conventions
   - Potential bugs or logic errors
   - Type safety and proper error handling

2. **Run Tests**: Execute the test suite:
   \`\`\`bash
   cd frontend && bun run type-check
   cd frontend && bun run lint
   cd backend && bun run type-check
   \`\`\`

3. **Report**: Provide a summary of findings with:
   - Issues found (critical, warning, info)
   - Test results (pass/fail)
   - Suggestions for improvement

## Configuration
- **Max items per run**: 5
- **Target columns**: To Review
`,
  },
  {
    id: "implement",
    name: "Implement",
    description: "Implement tasks from the board automatically",
    icon: Code,
    content: `# Implement Skill

## Trigger
When tasks are in the "To Do" column and assigned to AI.

## Instructions

1. **Read the task**: Understand the requirements from the work item description and definition of done.

2. **Explore codebase**: Use semantic search to understand existing patterns and conventions.

3. **Implement**: Write code following:
   - Project architecture (DDD layers, Clean Architecture)
   - Existing conventions and patterns
   - TypeScript best practices

4. **Verify**: Run type-check and lint before committing.

5. **Commit**: Create a descriptive commit with the task ID.

## Configuration
- **Max items per run**: 3
- **Target columns**: To Do
`,
  },
  {
    id: "review",
    name: "Review",
    description: "Perform code review on pull requests",
    icon: FileSearch,
    content: `# Code Review Skill

## Trigger
When a pull request is opened or updated.

## Instructions

1. **Review changes**: Analyze the diff for:
   - Correctness and completeness
   - Security vulnerabilities (OWASP top 10)
   - Performance implications
   - Test coverage

2. **Check conventions**: Verify adherence to:
   - Project coding standards
   - Architecture patterns (DDD, Clean Architecture)
   - Naming conventions

3. **Provide feedback**: Comment on the PR with:
   - Blocking issues (must fix)
   - Suggestions (nice to have)
   - Positive feedback (good patterns)

## Configuration
- **Max items per run**: 10
`,
  },
  {
    id: "document",
    name: "Document",
    description: "Generate documentation for completed features",
    icon: FileText,
    content: `# Document Skill

## Trigger
When work items are moved to the "To Document" column.

## Instructions

1. **Analyze changes**: Read the work item, linked commits, and changed files.

2. **Generate documentation**:
   - Feature description and purpose
   - API endpoints (if applicable)
   - UI screenshots or component descriptions
   - Configuration or environment changes

3. **Create document**: Write the documentation in the project's docs format.

4. **Link**: Associate the document with the work item.

## Configuration
- **Max items per run**: 5
- **Target columns**: To Document
`,
  },
  {
    id: "custom",
    name: "Custom",
    description: "Start from scratch with a basic template",
    icon: Puzzle,
    content: `# [CUSTOMIZE] Skill Name

## Trigger
[CUSTOMIZE] Describe when this skill should be triggered.

## Instructions

[CUSTOMIZE] Write step-by-step instructions for the agent:

1. **Step 1**: [CUSTOMIZE] First action
2. **Step 2**: [CUSTOMIZE] Second action
3. **Step 3**: [CUSTOMIZE] Third action

## Configuration
- **Max items per run**: [CUSTOMIZE]
- **Target columns**: [CUSTOMIZE]
`,
  },
];
