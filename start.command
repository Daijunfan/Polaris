#!/bin/sh
set -u

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

is_supported_node() {
  "$1" -e "const [maj,min]=(process.versions.node||'').split('.').map(Number);process.exit(maj>22||(maj===22&&min>=12)?0:1)" >/dev/null 2>&1
}

NODE_BIN=""
OLDER_NODE=""
OLDER_VER=""

check_candidate() {
  cand="$1"
  [ -n "$cand" ] && [ -x "$cand" ] || return 1
  if is_supported_node "$cand"; then
    NODE_BIN="$cand"
    return 0
  fi
  if [ -z "$OLDER_NODE" ]; then
    OLDER_NODE="$cand"
    OLDER_VER="$("$cand" -v 2>/dev/null || echo unknown)"
  fi
  return 1
}

if PATH_NODE="$(command -v node 2>/dev/null || true)" && [ -n "$PATH_NODE" ]; then
  check_candidate "$PATH_NODE" || true
fi

if [ -z "$NODE_BIN" ]; then
  for cand in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /opt/local/bin/node \
    "$HOME/.volta/bin/node" \
    "$HOME/.asdf/shims/node" \
    "$HOME/.local/share/mise/shims/node"
  do
    check_candidate "$cand" && break || true
  done
fi

if [ -z "$NODE_BIN" ]; then
  NVM_ROOT="${NVM_DIR:-$HOME/.nvm}"
  if [ -d "$NVM_ROOT/versions/node" ]; then
    OLD_IFS="$IFS"
    IFS='
'
    for cand in $(ls -1d "$NVM_ROOT"/versions/node/*/bin/node 2>/dev/null | sort -r); do
      IFS="$OLD_IFS"
      check_candidate "$cand" && break || true
    done
    IFS="$OLD_IFS"
  fi
fi

if [ -z "$NODE_BIN" ]; then
  for fnm_dir in \
    "${FNM_DIR:-$HOME/.local/share/fnm}" \
    "$HOME/Library/Application Support/fnm" \
    "$HOME/.fnm"
  do
    check_candidate "$fnm_dir/aliases/default/bin/node" && break || true
    if [ -d "$fnm_dir/node-versions" ]; then
      OLD_IFS="$IFS"
      IFS='
'
      for cand in $(ls -1d "$fnm_dir"/node-versions/*/installation/bin/node 2>/dev/null | sort -r); do
        IFS="$OLD_IFS"
        check_candidate "$cand" && break || true
      done
      IFS="$OLD_IFS"
    fi
    [ -n "$NODE_BIN" ] && break || true
  done
fi

if [ -z "$NODE_BIN" ]; then
  for login_shell in "${SHELL:-}" /bin/zsh /bin/bash; do
    [ -n "$login_shell" ] && [ -x "$login_shell" ] || continue
    if LOGIN_NODE="$("$login_shell" -lc 'command -v node' 2>/dev/null | tail -n 1 || true)" && [ -n "$LOGIN_NODE" ]; then
      check_candidate "$LOGIN_NODE" && break || true
    fi
  done
fi

if [ -z "$NODE_BIN" ]; then
  if [ -n "$OLDER_NODE" ]; then
    echo "错误：检测到 Node.js $OLDER_VER（位于 $OLDER_NODE），但北极星需要 Node.js 22.12 或更新版本。" >&2
    echo "Error: Found Node.js $OLDER_VER at $OLDER_NODE, but Polaris requires Node.js 22.12+." >&2
  else
    echo "错误：未找到 Node.js 22.12 或更新版本。" >&2
    echo "Error: Node.js 22.12+ was not found in PATH, Homebrew, nvm, fnm, volta, asdf, or mise." >&2
  fi
  echo "请先安装 Node.js 22.12+（例如：brew install node 或访问 https://nodejs.org/）。" >&2
  echo "Please install Node.js 22.12+ (e.g. 'brew install node' or https://nodejs.org/)." >&2
  if [ -t 0 ] && [ -z "${CI:-}" ] && [ "${POLARIS_NO_PAUSE:-0}" != "1" ]; then
    printf "按回车键关闭窗口 / Press Enter to close..."
    read -r _
  fi
  exit 1
fi

NODE_DIR="$(dirname -- "$NODE_BIN")"
export PATH="$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:$PATH"

"$NODE_BIN" "$ROOT/scripts/start.mjs" "$@"
status=$?

if [ "$status" -ne 0 ] && [ -t 0 ] && [ -z "${CI:-}" ] && [ "${POLARIS_NO_PAUSE:-0}" != "1" ]; then
  printf "启动失败（退出码 %s），按回车键关闭窗口 / Launch failed (exit %s), press Enter to close..." "$status" "$status"
  read -r _
fi

exit "$status"
