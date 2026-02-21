"""
Unit tests for ai.py — parse_ai_response and related utilities.
"""

import sys
import os

# Ensure backend directory is on the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ai import parse_ai_response, ParsedFile, ParsedResponse


class TestParseAiResponse:
    """Tests for parse_ai_response()."""

    def test_single_file_block(self):
        text = """FILE: src/App.tsx
```tsx
import React from "react";

export default function App() {
  return <div>Hello</div>;
}
```

EXPLANATION:
Created a simple App component.
"""
        result = parse_ai_response(text)
        assert len(result.files) == 1
        assert result.files[0].filename == "src/App.tsx"
        assert "export default function App" in result.files[0].content
        assert result.files[0].language == "tsx"
        assert "Created a simple App component" in result.explanation

    def test_multiple_file_blocks(self):
        text = """FILE: src/App.tsx
```tsx
export default function App() { return <div>App</div>; }
```

FILE: src/components/Header.tsx
```tsx
export default function Header() { return <header>Header</header>; }
```

EXPLANATION:
Built the app and header.
"""
        result = parse_ai_response(text)
        assert len(result.files) == 2
        assert result.files[0].filename == "src/App.tsx"
        assert result.files[1].filename == "src/components/Header.tsx"

    def test_pattern2_file_inside_code_block(self):
        text = """```tsx FILE: src/App.tsx
export default function App() { return <div>Hello</div>; }
```
"""
        result = parse_ai_response(text)
        assert len(result.files) == 1
        assert result.files[0].filename == "src/App.tsx"

    def test_no_files(self):
        text = "This is just a text explanation with no file blocks."
        result = parse_ai_response(text)
        assert len(result.files) == 0
        assert "text explanation" in result.explanation

    def test_empty_input(self):
        result = parse_ai_response("")
        assert len(result.files) == 0
        assert result.explanation == ""

    def test_default_language(self):
        text = """FILE: src/index.css
```
body { margin: 0; }
```
"""
        result = parse_ai_response(text)
        assert len(result.files) == 1
        assert result.files[0].language == "tsx"  # default
        assert "body { margin: 0; }" in result.files[0].content

    def test_json_file(self):
        text = """FILE: package.json
```json
{
  "name": "test-app",
  "version": "1.0.0"
}
```
"""
        result = parse_ai_response(text)
        assert len(result.files) == 1
        assert result.files[0].filename == "package.json"
        assert result.files[0].language == "json"

    def test_explanation_extraction(self):
        text = """Some preamble text.

FILE: src/App.tsx
```tsx
export default function App() {}
```

EXPLANATION:
This is the explanation text.
"""
        result = parse_ai_response(text)
        assert len(result.files) == 1
        assert "explanation text" in result.explanation
        assert "Some preamble" in result.explanation
