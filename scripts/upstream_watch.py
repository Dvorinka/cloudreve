#!/usr/bin/env python3
"""Daily upstream watch across the cloudreve/* upstream repos.

Collects open issues and PRs from each upstream repository, marks the ones
already cited in our tree (inline `#NNNN` comments or commit-message
references), and reports the rest as untriaged. Also reports how far the
vendored directories (frontend/, cli/, docs/) and the backend fork are
behind their upstream heads.

The report is written to a single pinned GitHub issue labelled
`upstream-watch`; a comment is posted only when new untriaged items appear.

Requires: `gh` CLI authenticated (GH_TOKEN), run from the repo root with
`upstream` remote fetched.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPOS = [
    "cloudreve/cloudreve",
    "cloudreve/frontend",
    "cloudreve/cli",
    "cloudreve/docs",
    "cloudreve/desktop",
]

TRACKING_LABEL = "upstream-watch"
TRACKING_TITLE = "Upstream watch"
SELF_REPO = os.environ.get("GITHUB_REPOSITORY", "Dvorinka/cloudreve")
PINS_FILE = Path(".github/upstream-pins.json")
PENDING_MARKER = re.compile(r"<!--\s*pending:\s*(\{.*?\})\s*-->", re.S)
NUM_RE = re.compile(r"#(\d{3,5})")
PR_NUM_RE = re.compile(r"(?:PR|pr)\s*#(\d+)")


def gh(*args: str) -> str:
    return subprocess.run(
        ["gh", *args], check=True, capture_output=True, text=True
    ).stdout


def gh_json(*args: str):
    return json.loads(gh(*args))


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], check=True, capture_output=True, text=True
    ).stdout


def cited_numbers() -> set[int]:
    """Numbers referenced anywhere in tracked sources or commit history.

    The fork's convention is inline `(#NNNN)` / `upstream #NNNN` comments and
    `upstream PR#NN` in commit messages for ported fixes.
    """
    text = git(
        "grep", "-hoE", "#[0-9]{3,5}", "--",
        "*.go", "*.ts", "*.tsx", "*.rs", "*.py", "*.md",
    )
    text += git("log", "--format=%B", "-n", "3000")
    return {int(n) for n in NUM_RE.findall(text)} | {
        int(n) for n in PR_NUM_RE.findall(text)
    }


def open_items(repo: str) -> list[dict]:
    """Open issues and PRs; /issues returns both, PRs carry .pull_request.

    Sorted by updated-desc so the freshest upstream activity surfaces first
    in the report instead of being buried under long-stale items.
    """
    return gh_json(
        "api", "--paginate",
        f"repos/{repo}/issues?state=open&per_page=100&sort=updated&direction=desc",
    )


def vendored_drift() -> list[str]:
    if not PINS_FILE.exists():
        return []
    pins = json.loads(PINS_FILE.read_text())
    lines = []
    for dirname, pin in pins.items():
        if not isinstance(pin, dict):
            continue
        repo, sha = pin["repo"], pin["sha"]
        try:
            cmp = gh_json("api", f"repos/{repo}/compare/{sha}...HEAD")
        except subprocess.CalledProcessError:
            lines.append(f"- `{dirname}/` ← `{repo}`: pin {sha[:8]} not reachable")
            continue
        count = cmp.get("total_commits", 0)
        subjects = [c["commit"]["message"].split("\n")[0] for c in cmp.get("commits", [])[:10]]
        lines.append(f"- `{dirname}/` ← `{repo}`: **{count}** new commit(s) since {sha[:8]}")
        lines += [f"  - {s}" for s in subjects]
    return lines


def backend_drift() -> list[str]:
    try:
        subjects = git("log", "--format=%s", "HEAD..upstream/master").splitlines()
    except subprocess.CalledProcessError:
        return []
    if not subjects:
        return ["- backend is up to date with `cloudreve/cloudreve`"]
    lines = [f"- backend is **{len(subjects)}** commit(s) behind `upstream/master`:"]
    lines += [f"  - {s}" for s in subjects[:30]]
    return lines


def issue_link(repo: str, n: int, pr: bool) -> str:
    kind = "pull" if pr else "issues"
    return f"[#{n}](https://github.com/{repo}/{kind}/{n})"


def build_report(
    cited: set[int], prev_pending: dict[str, list[int]]
) -> tuple[str, dict[str, list[int]], list[tuple[str, int, bool]]]:
    out = [
        "_Daily scan of open upstream issues/PRs. Items already cited in this",
        "repo's code or history are marked ✅; the rest are the untriaged set._",
        "",
    ]
    # First pass: collect everything so the "new since last scan" section can
    # lead the report.
    per_repo: dict[str, list[dict]] = {repo: open_items(repo) for repo in REPOS}
    pending: dict[str, list[int]] = {}
    new_items: list[tuple[str, int, bool]] = []
    for repo, items in per_repo.items():
        untriaged = [i for i in items if i["number"] not in cited]
        pending[repo] = [i["number"] for i in untriaged]
        prev = set(prev_pending.get(repo, []))
        for i in untriaged:
            if i["number"] not in prev:
                new_items.append((repo, i["number"], "pull_request" in i))

    if new_items:
        out.append("## 🆕 New since last scan")
        for repo, n, is_pr in new_items:
            title = next(
                (i["title"] for i in per_repo[repo] if i["number"] == n), ""
            )[:110].replace("|", "\\|")
            tag = "PR" if is_pr else "issue"
            out.append(f"- {repo} {tag} {issue_link(repo, n, is_pr)} — {title}")
        out.append("")

    for repo in REPOS:
        items = per_repo[repo]
        issues = [i for i in items if "pull_request" not in i]
        prs = [i for i in items if "pull_request" in i]
        out.append(f"### [{repo}](https://github.com/{repo}) — {len(issues)} open issues, {len(prs)} open PRs")
        untriaged = [i for i in items if i["number"] not in cited]
        pending[repo] = [i["number"] for i in untriaged]
        if not untriaged:
            out.append("All open items are cited in this repo. ✅")
        else:
            for i in untriaged[:80]:
                is_pr = "pull_request" in i
                tag = "PR" if is_pr else "issue"
                title = i["title"][:110].replace("|", "\\|")
                out.append(
                    f"- {tag} {issue_link(repo, i['number'], is_pr)} — {title} "
                    f"(updated {i['updated_at'][:10]})"
                )
            if len(untriaged) > 80:
                out.append(f"- … and {len(untriaged) - 80} more")
        out.append("")
    out.append("### Vendored directory drift")
    out += vendored_drift() or ["- no pins configured"]
    out.append("")
    out.append("### Backend divergence")
    out += backend_drift()
    out.append("")
    out.append(f"<!-- pending: {json.dumps(pending, sort_keys=True)} -->")
    return "\n".join(out), pending, new_items


def previous_pending(body: str) -> dict[str, list[int]]:
    old = PENDING_MARKER.search(body)
    return json.loads(old.group(1)) if old else {}


def tracking_issue() -> tuple[int | None, str]:
    try:
        gh("label", "create", TRACKING_LABEL, "--repo", SELF_REPO,
           "--description", "Automated upstream issue/PR watch", "--color", "0e8a16")
    except subprocess.CalledProcessError:
        pass  # label exists
    issues = gh_json(
        "issue", "list", "--repo", SELF_REPO, "--label", TRACKING_LABEL,
        "--state", "open", "--limit", "1", "--json", "number,body",
    )
    if not issues:
        return None, ""
    return issues[0]["number"], issues[0].get("body") or ""


def main() -> int:
    number, old_body = tracking_issue()
    report, _pending, new_items = build_report(
        cited_numbers(), previous_pending(old_body)
    )
    Path("upstream-report.md").write_text(report)

    if number is None:
        gh("issue", "create", "--repo", SELF_REPO, "--title", TRACKING_TITLE,
           "--label", TRACKING_LABEL, "--body", report)
        print("created tracking issue")
        return 0

    gh("issue", "edit", str(number), "--repo", SELF_REPO, "--body", report)

    if new_items:
        lines = ["New untriaged upstream items:", ""]
        for repo, n, is_pr in new_items:
            tag = "PR" if is_pr else "issue"
            lines.append(f"- {repo} {tag} {issue_link(repo, n, is_pr)}")
        gh("issue", "comment", str(number), "--repo", SELF_REPO, "--body", "\n".join(lines))
        print(f"commented {len(new_items)} new items on #{number}")
    else:
        print(f"updated #{number}, no new items")
    return 0


if __name__ == "__main__":
    sys.exit(main())
