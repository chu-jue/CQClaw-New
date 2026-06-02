#!/usr/bin/env python3
"""ADB Command Box launcher.

The implementation has been moved to backend.legacy_core as a first
conservative refactor step. Keeping this file thin reduces the risk of future
changes touching the process bootstrap and business logic at the same time.
"""

from backend.legacy_core import main


if __name__ == "__main__":
    main()
