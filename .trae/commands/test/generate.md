---
Name: test-generate
Description: 为代码自动生成单元测试
Category: test
Icon: 🧪
Aliases: [tg, gen-test]
Args:
  - name: framework
    required: false
    type: string
    choices: [pytest, unittest, jest]
    default: pytest
---

Instructions: |
  Generate comprehensive unit tests for the selected code.

  Test framework: {framework}

  Coverage requirements:
  - Happy path scenarios
  - Edge cases (empty input, null, boundary values)
  - Error conditions
  - Mock external dependencies

  Include:
  - Test file with imports
  - Fixtures and setup
  - Parametrized tests where appropriate
  - Assertions with meaningful messages
