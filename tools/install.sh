#!/bin/sh
# install.sh: install omega-harness from Radicle main at a recorded head, or check an installation.
#
#   tools/install.sh --skills DIR [--check] [--source URL] [--rev SHA]
#       Copy every skills/<name>/ of main into DIR (other skills in DIR are left alone) and record
#       the head in DIR/.installed-from-omega-harness. With --check, change nothing: exit 1 when the
#       recorded head is not main's head or an installed skill differs from main's copy.
#   tools/install.sh --omc OMC|auto [--check] [--source URL] [--rev SHA] [--overlay FILE]
#       On a Linux AArch64 host: build tools/rules with OMC (its sha256 must be PIN's; `auto` takes
#       seed/out/omc at PIN's omega-mv commit from omega-mv's Radicle storage or mirror), then install
#       or check every skills directory and instruction file that FILE names (default
#       ~/.config/omega-harness/local.rules; `skills DIR` and `target PROGRAM PATH` records). Each
#       instruction file is rendered from rules/rules.txt plus FILE. A file kept by aien-keep (its
#       path resolves under /srv/aien-keep/) is replaced only through `sudo aien-keep update` (the
#       keeper keeps the old copy); any other through a rename, after a dated backup under
#       ~/.local/state/omega-harness/backups/. The landing trigger is the landing tools' post-landing
#       hook, which runs the landed head's own `tools/install.sh --omc auto --rev <landed head>` in
#       the background. A failed install (exit 2) is written to the overlay's `alarm` file by this
#       script; nothing runs on a clock and nothing is hooked inside Radicle storage.
#
# SOURCE is the local Radicle storage of omega-harness when it exists, else the HTTPS mirror. --rev
# installs that commit instead of main's head (the post-landing hook passes the landed head).
# This file is invocation glue (clone, copy, compare, rename); what is generated and how is decided
# by tools/rules.om. Exit 0 installed or current, 1 a check found a difference, 2 usage or a failed step.
set -u
PATH=$HOME/.local/bin:$PATH
RID=z39gvwWsnkRZsAConQLjaKiNVLHfW
STORE=${RAD_HOME:-$HOME/.radicle}/storage/$RID
check=0 sdir= omc= overlay=$HOME/.config/omega-harness/local.rules source= rev=
while [ $# -gt 0 ]; do
    case $1 in
        --check) check=1 ;;
        --rev) rev=${2:?}; shift ;;
        --skills) sdir=${2:?}; shift ;;
        --omc) omc=${2:?}; shift ;;
        --overlay) overlay=${2:?}; shift ;;
        --source) source=${2:?}; shift ;;
        *) sed -n '2,24s/^# \{0,1\}//p' "$0" >&2; exit 2 ;;
    esac
    shift
done
[ -n "$sdir$omc" ] || { sed -n '2,24s/^# \{0,1\}//p' "$0" >&2; exit 2; }
if [ -z "$source" ]; then
    if [ -d "$STORE" ]; then source=$STORE; else source=https://www.aienos.com/rad/$RID.git; fi
fi
unset GIT_DIR GIT_NAMESPACE GIT_WORK_TREE GIT_INDEX_FILE
export GIT_TERMINAL_PROMPT=0
tmp=$(mktemp -d) || exit 2
trap 'rm -rf "$tmp"' EXIT
git clone -q --no-checkout "$source" "$tmp/h" || { echo "install: cannot clone $source" >&2; exit 2; }
[ -n "$rev" ] || rev=$(git -C "$tmp/h" rev-parse refs/remotes/origin/main) || exit 2
git -C "$tmp/h" cat-file -e "$rev^{commit}" 2>/dev/null ||
    git -C "$tmp/h" fetch -q --upload-pack="git -c uploadpack.allowAnySHA1InWant=true upload-pack" origin "$rev" ||
    { echo "install: cannot fetch $rev from $source" >&2; exit 2; }
git -C "$tmp/h" checkout -q --detach "$rev" || { echo "install: $rev is not in $source" >&2; exit 2; }
head=$(git -C "$tmp/h" rev-parse HEAD)
mark="rad:$RID@$head"
rc=0

# skills DIR: copy the repository's skills into DIR (or a staged copy of DIR) and mark the head
put_skills() {
    for s in "$tmp/h"/skills/*/; do
        n=$(basename "$s")
        rm -rf "$1/.$n.new" && cp -R "$s" "$1/.$n.new" || return 1
        if [ -e "$1/$n" ] || [ -L "$1/$n" ]; then mv "$1/$n" "$1/.$n.old" || return 1; fi
        mv "$1/.$n.new" "$1/$n" && rm -rf "$1/.$n.old" || return 1
    done
    printf '%s\n' "$mark" > "$1/.installed-from-omega-harness"
}

do_skills() {
    d=$1
    if [ "$check" = 1 ]; then
        got=$(head -n 1 "$d/.installed-from-omega-harness" 2>/dev/null)
        if [ "$got" != "$mark" ]; then
            echo "BEHIND $d: installed ${got:-nothing recorded}, main $mark"; rc=1; return
        fi
        for s in "$tmp/h"/skills/*/; do
            n=$(basename "$s")
            diff -rq "$s" "$d/$n" > /dev/null 2>&1 || { echo "MODIFIED $d/$n: differs from $mark"; rc=1; }
        done
        return
    fi
    case $(readlink -f "$d") in
        /srv/aien-keep/*)
            rm -rf "$tmp/stage" && mkdir -p "$tmp/stage" || { rc=2; return; }
            cp -a "$(readlink -f "$d")/." "$tmp/stage/" || { rc=2; return; }
            chmod -R u+w "$tmp/stage"
            put_skills "$tmp/stage" || { echo "install: staging $d failed" >&2; rc=2; return; }
            sudo -n aien-keep update "$d" "$tmp/stage" > /dev/null || { echo "install: aien-keep update $d failed" >&2; rc=2; return; }
            ;;
        *)
            mkdir -p "$d" && put_skills "$d" || { echo "install: $d failed" >&2; rc=2; return; }
            ;;
    esac
    echo "INSTALLED $d $mark"
}

if [ -z "$omc" ]; then
    do_skills "$sdir"
    exit $rc
fi

[ -f "$tmp/h/PIN" ] && [ -f "$tmp/h/tools/rules.om" ] ||
    { echo "install: $head has no PIN or tools/rules.om (install from a commit that has them)" >&2; exit 2; }
if [ "$omc" = auto ]; then
    # the compiler PIN names, taken from omega-mv's Radicle storage (or its HTTPS mirror)
    mvrid=z6do9WDBhuSnvopDkgFdFr1yWA62
    mvrev=$(sed -n 's/^omega-mv //p' "$tmp/h/PIN")
    mvs=${RAD_HOME:-$HOME/.radicle}/storage/$mvrid
    [ -d "$mvs" ] || { git clone -q --bare --filter=blob:none "https://www.aienos.com/rad/$mvrid.git" "$tmp/mv" && mvs=$tmp/mv; }
    git --git-dir "$mvs" cat-file blob "$mvrev:seed/out/omc" > "$tmp/omc" && chmod +x "$tmp/omc" ||
        { echo "install: cannot read seed/out/omc at omega-mv $mvrev" >&2; exit 2; }
    omc=$tmp/omc
fi
pinned=$(sed -n 's/^omc-sha256 //p' "$tmp/h/PIN")
got=$(sha256sum "$omc" 2>/dev/null | cut -d' ' -f1)
[ -n "$pinned" ] && [ "$got" = "$pinned" ] || { echo "install: omc sha256 ${got:-unreadable}, PIN wants $pinned" >&2; exit 2; }
"$omc" < "$tmp/h/tools/rules.om" > "$tmp/rules" && chmod +x "$tmp/rules" || { echo "install: tools/rules.om does not compile" >&2; exit 2; }
[ -f "$overlay" ] || { echo "install: no overlay $overlay" >&2; exit 2; }
rhead=$(git -C "$tmp/h" log -1 --format=%H -- rules tools/rules.om)
"$tmp/rules" targets "$tmp/h/rules/rules.txt" "$overlay" > "$tmp/targets" || { echo "install: rules targets failed" >&2; exit 2; }
alarm=$(sed -n 's/^alarm - //p' "$tmp/targets" | head -n 1)
while read -r kind prog path; do
    case $kind in
        skills) do_skills "$path" < /dev/null ;;
        target)
            "$tmp/rules" render "$tmp/h/rules/rules.txt" "$overlay" "$prog" "$rhead" > "$tmp/out" || { rc=2; continue; }
            cmp -s "$tmp/out" "$path" && continue
            if [ "$check" = 1 ]; then echo "DIFFERS $path: not the rendering of rules at $rhead"; rc=1; continue; fi
            case $(readlink -f "$path") in
                /srv/aien-keep/*)
                    sudo -n aien-keep update "$path" "$tmp/out" > /dev/null < /dev/null || { echo "install: aien-keep update $path failed" >&2; rc=2; continue; } ;;
                *)
                    bk=${XDG_STATE_HOME:-$HOME/.local/state}/omega-harness/backups
                    mkdir -p "$bk" && [ ! -e "$path" ] || cp -p "$path" "$bk/$(printf '%s' "$path" | tr / _).$(date -u +%Y%m%dT%H%M%SZ)" || { rc=2; continue; }
                    cp "$tmp/out" "$path.generated-tmp" && mv "$path.generated-tmp" "$path" || { rc=2; continue; } ;;
            esac
            cmp -s "$tmp/out" "$path" || { echo "install: $path does not read back" >&2; rc=2; continue; }
            echo "INSTALLED $path rules@$rhead" ;;
    esac
done < "$tmp/targets"
if [ "$rc" = 2 ] && [ "$check" = 0 ] && [ -n "$alarm" ]; then
    echo "$(date -u +%FT%TZ) omega-harness: tools/install.sh at $head FAILED (exit 2); rerun it to see why" >> "$alarm"
fi
exit $rc
