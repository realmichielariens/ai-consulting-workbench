import sys
from markitdown import MarkItDown

md = MarkItDown()
for path in sys.argv[1:]:
    print(f"=== {path} ===")
    try:
        result = md.convert(path)
        print(result.text_content)
    except Exception as e:
        print(f"ERROR: {type(e).__name__}: {e}")
    print()
