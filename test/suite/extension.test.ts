import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import MarkdownIt from 'markdown-it';
import { extendMarkdownItWithMermaid } from '../../src/shared/markdownItMermaid';

suite('Markdown-It Mermaid Plugin', () => {
  let md: MarkdownIt;

  setup(() => {
    md = new MarkdownIt();
    extendMarkdownItWithMermaid(md, {
      languageIds: () => ['mermaid'],
    });
  });

  test('should render mermaid code fence as pre.mermaid', () => {
    const input = '```mermaid\ngraph TD;\n    A-->B;\n```';
    const result = md.render(input);
    assert.ok(result.includes('<pre class="mermaid"'), 'Should contain mermaid pre');
    assert.ok(result.includes('data-mermaid-source='), 'Should contain data-mermaid-source attribute');
    assert.ok(result.includes('A--&gt;B;'), 'Should contain escaped diagram content');
  });

  test('should render ::: mermaid block as pre.mermaid', () => {
    const input = '::: mermaid\ngraph TD;\n    A-->B;\n:::';
    const result = md.render(input);
    assert.ok(result.includes('<pre class="mermaid"'), 'Should contain mermaid pre');
    assert.ok(result.includes('data-mermaid-source='), 'Should contain data-mermaid-source attribute');
  });

  test('should not affect non-mermaid code fences', () => {
    const input = '```javascript\nconsole.log("hello");\n```';
    const result = md.render(input);
    assert.ok(!result.includes('class="mermaid"'), 'Should not contain mermaid class');
  });

  test('should support custom language IDs', () => {
    const customMd = new MarkdownIt();
    extendMarkdownItWithMermaid(customMd, {
      languageIds: () => ['mermaid', 'mmd'],
    });
    const input = '```mmd\ngraph TD;\n    A-->B;\n```';
    const result = customMd.render(input);
    assert.ok(result.includes('<pre class="mermaid"'), 'Should render custom language ID');
  });

  test('should escape HTML entities in diagram content', () => {
    const input = '```mermaid\ngraph TD;\n    A["<script>alert(1)</script>"]-->B;\n```';
    const result = md.render(input);
    assert.ok(!result.includes('<script>'), 'Should not contain raw script tag');
    assert.ok(result.includes('&lt;script&gt;'), 'Should contain escaped script tag');
  });

  test('should encode source in data-mermaid-source attribute', () => {
    const input = '```mermaid\npie title "Test"\n    "A" : 100\n```';
    const result = md.render(input);
    const match = result.match(/data-mermaid-source="([^"]*)"/);
    assert.ok(match, 'Should have data-mermaid-source attribute');
    const decoded = decodeURIComponent(match![1]);
    assert.ok(decoded.startsWith('pie title'), 'Decoded source should start with diagram type');
  });
});

suite('Mermaid Diagram Type Fixtures', () => {
  const fixturesDir = path.resolve(__dirname, '../../test/fixtures');
  let md: MarkdownIt;

  setup(() => {
    md = new MarkdownIt();
    extendMarkdownItWithMermaid(md, {
      languageIds: () => ['mermaid'],
    });
  });

  const fixtures = [
    'flowchart.md',
    'sequence.md',
    'gantt.md',
    'classDiagram.md',
    'stateDiagram.md',
    'pie.md',
    'erDiagram.md',
    'mindmap.md',
  ];

  for (const fixture of fixtures) {
    test(`should parse ${fixture} fixture as mermaid diagram`, () => {
      const filePath = path.join(fixturesDir, fixture);
      if (!fs.existsSync(filePath)) {
        assert.fail(`Fixture file ${fixture} not found at ${filePath}`);
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      const result = md.render(content);
      assert.ok(
        result.includes('<pre class="mermaid"'),
        `${fixture} should produce a mermaid pre element`
      );
      assert.ok(
        result.includes('data-mermaid-source='),
        `${fixture} should have data-mermaid-source attribute`
      );
    });
  }
});
