//! Killing a child is not enough.
//!
//! The agent we spawn is a Node process that goes on to start a Python kernel,
//! `uv`, MCP servers, and whatever the model's `bash` tool runs. Signalling the
//! Node pid leaves every one of those alive with no parent — they keep holding
//! file descriptors, keep burning CPU, and are invisible in the UI because our
//! own process-diagnostics view only walks descendants of the app.
//!
//! So we put each agent in its own process group at spawn time and signal the
//! whole group on teardown. The child becomes a group leader, which makes the
//! group id equal to its pid, so callers only need to remember the pid they
//! already have.

/// Put the child in a new process group, with itself as leader.
///
/// Must be called before `spawn`. On platforms without POSIX process groups
/// this is a no-op and teardown falls back to signalling the child alone.
pub fn lead_new_group(cmd: &mut tokio::process::Command) {
    #[cfg(unix)]
    {
        // SAFETY: runs in the forked child between fork and exec, where only
        // async-signal-safe calls are allowed. `setpgid` is on that list.
        unsafe {
            cmd.pre_exec(|| {
                if libc::setpgid(0, 0) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    #[cfg(not(unix))]
    let _ = cmd;
}

/// Ask every process in `pid`'s group to exit, without waiting.
///
/// For callers that own the child handle and can reap it themselves
/// (`try_wait()` in their own polling loop) — `terminate_group`'s liveness
/// probe (`kill(pid, 0)`) keeps succeeding for an unreaped zombie, so an
/// owning caller polling that way would always burn the full grace period.
pub fn signal_group_term(pid: u32) {
    #[cfg(unix)]
    // SAFETY: kill(2) with a negative pid signals a process group. A stale
    // group id yields ESRCH, which we ignore.
    unsafe {
        libc::kill(-(pid as i32), libc::SIGTERM);
    }
    #[cfg(not(unix))]
    let _ = pid;
}

/// Force-kill every process in `pid`'s group. SIGKILL cannot be caught.
pub fn signal_group_kill(pid: u32) {
    #[cfg(unix)]
    // SAFETY: same contract as `signal_group_term`.
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
    #[cfg(not(unix))]
    let _ = pid;
}

/// Whether any process in `pid`'s group is still alive.
///
/// Probes the *group*, not the leader. The distinction matters once the
/// leader has been reaped: `kill(pid, 0)` then reports "gone" while the
/// Python kernel and MCP servers it started are still running, which is
/// exactly how a crashed agent left a process tree behind. `kill(-pgid, 0)`
/// succeeds as long as the group has a member.
pub fn group_is_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // SAFETY: signal 0 tests for existence without delivering anything;
        // a negative pid addresses the process group.
        unsafe { libc::kill(-(pid as i32), 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}

/// Ask every process in `pid`'s group to exit, then insist.
///
/// Returns once the leader is gone or the grace period expires. Callers run
/// this on the way out, so it blocks rather than spawning: an async kill that
/// nobody awaits is how the orphans got there in the first place.
pub fn terminate_group(pid: u32, grace: std::time::Duration) {
    #[cfg(unix)]
    {
        let group = -(pid as i32);
        // SAFETY: kill(2) with a negative pid signals a process group. A stale
        // group id yields ESRCH, which we ignore.
        unsafe {
            libc::kill(group, libc::SIGTERM);
        }

        // Give the group a moment to run its own cleanup — the harness flushes
        // session state on SIGTERM, and losing that costs the user their
        // resumable transcript.
        let deadline = std::time::Instant::now() + grace;
        while std::time::Instant::now() < deadline {
            // SAFETY: signal 0 tests for existence without delivering anything.
            if unsafe { libc::kill(pid as i32, 0) } == -1 {
                return; // leader is gone
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        // SAFETY: same contract as above; SIGKILL cannot be caught.
        unsafe {
            libc::kill(group, libc::SIGKILL);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (pid, grace);
    }
}

/// Kill agent process trees left behind by a previous run of this app.
///
/// The in-process teardown paths only help when the app gets to run code. A
/// SIGKILL, a panic in the wrong thread, or a hard power-off leaves the
/// sidecar's Node process — and the Python kernel, MCP servers and bash
/// children under it — running with no parent. They are invisible in the UI,
/// hold their memory, and one observed set survived for 23 hours.
///
/// Identification is deliberately narrow, because getting it wrong means
/// killing something that is not ours:
///
/// - the executable path must be exactly the `node` binary inside this app's
///   sidecar directory, and
/// - the parent must be pid 1, which is true only after the real parent died.
///
/// A second window or a concurrently running copy of the app has a live
/// parent, so its agents are never matched.
///
/// Returns the number of process groups signalled.
pub fn reap_orphans(sidecar_dir: &std::path::Path) -> usize {
    let node = sidecar_dir.join("node");
    let Some(node) = node.to_str() else { return 0 };
    let Ok(output) = std::process::Command::new("ps").args(["-eo", "pid=,ppid=,comm="]).output() else {
        return 0;
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut reaped = 0;
    for pid in orphan_pids(&stdout, node) {
        log::warn!("[reaper] killing orphaned agent process group {pid} from a previous run");
        signal_group_term(pid);
        reaped += 1;
    }
    if reaped > 0 {
        std::thread::sleep(std::time::Duration::from_millis(500));
        // Re-read: anything that ignored SIGTERM gets no second chance.
        if let Ok(output) = std::process::Command::new("ps").args(["-eo", "pid=,ppid=,comm="]).output() {
            for pid in orphan_pids(&String::from_utf8_lossy(&output.stdout), node) {
                signal_group_kill(pid);
            }
        }
    }
    reaped
}

/// Pick the orphaned sidecar processes out of `ps -eo pid=,ppid=,comm=`.
///
/// Split out from [`reap_orphans`] so the matching rule can be tested without
/// a process table that has orphans in it.
fn orphan_pids(ps_output: &str, node_path: &str) -> Vec<u32> {
    ps_output
        .lines()
        .filter_map(|line| {
            // Split on the first two runs of whitespace only: `ps` right-aligns
            // the numeric columns, and the command itself contains spaces
            // ("LAF Agent.app"), so a plain whitespace split loses the path.
            let (pid, rest) = line.trim_start().split_once(char::is_whitespace)?;
            let (ppid, comm) = rest.trim_start().split_once(char::is_whitespace)?;
            let pid: u32 = pid.parse().ok()?;
            let ppid: u32 = ppid.parse().ok()?;
            (ppid == 1 && comm.trim() == node_path).then_some(pid)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// The whole point: a grandchild the agent spawned must not survive.
    #[cfg(unix)]
    #[tokio::test]
    async fn terminating_the_group_reaches_a_grandchild() {
        let marker = std::env::temp_dir().join(format!("laf-pg-{}", std::process::id()));
        let _ = std::fs::remove_file(&marker);

        // A shell that backgrounds a grandchild which would outlive it, then
        // sleeps. Killing only the shell's pid would leave the grandchild
        // writing to the marker file for the next 30 seconds.
        let script = format!(
            "( while true; do echo alive > {m}; sleep 0.05; done ) & sleep 30",
            m = marker.display()
        );
        let mut cmd = tokio::process::Command::new("/bin/sh");
        cmd.arg("-c").arg(&script);
        lead_new_group(&mut cmd);
        let child = cmd.spawn().expect("spawn");
        let pid = child.id().expect("pid");

        // Let the grandchild come up and touch the marker.
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(marker.exists(), "grandchild never started");

        terminate_group(pid, Duration::from_millis(200));

        // Anything still running would recreate the marker within 50ms.
        std::fs::remove_file(&marker).ok();
        std::thread::sleep(Duration::from_millis(400));
        assert!(
            !marker.exists(),
            "a grandchild survived the group termination"
        );
    }

    /// The regression that produced 23-hour orphans: the leader exits, its
    /// children keep running, and a liveness probe aimed at the leader
    /// reports "gone". `group_is_alive` must still see the group.
    #[cfg(unix)]
    #[tokio::test]
    async fn the_group_reads_as_alive_after_its_leader_is_reaped() {
        let mut cmd = tokio::process::Command::new("/bin/sh");
        // Background a long sleeper, then let the shell itself exit.
        cmd.arg("-c").arg("( sleep 30 ) & exit 0");
        lead_new_group(&mut cmd);
        let mut child = cmd.spawn().expect("spawn");
        let pid = child.id().expect("pid");
        child.wait().await.expect("wait");

        // The leader is reaped: probing it alone says the work is done.
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1, "leader should be gone");
        // The group is not.
        assert!(group_is_alive(pid), "the backgrounded child should keep the group alive");

        signal_group_kill(pid);
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(!group_is_alive(pid), "the group should be gone after SIGKILL");
    }

    /// The reaper's matching rule, exercised against a synthetic table.
    #[test]
    fn orphan_matching_is_narrow() {
        let node = "/Applications/LAF Agent.app/Contents/Resources/resources/lafagent/node";
        let table = format!(
            "\
  100     1 {node}
  101   100 {node}
  102     1 /usr/local/bin/node
  103   999 {node}
  104     1 /Applications/Other.app/Contents/Resources/resources/lafagent/node
"
        );
        let pids = orphan_pids(&table, node);
        // 100 only: orphaned (ppid 1) and running our sidecar's node.
        //  101 has a live parent, 102 is a different binary, 103 has a live
        //  parent, 104 belongs to another app.
        assert_eq!(pids, vec![100]);
    }

    /// A malformed or empty process table must not panic.
    #[test]
    fn orphan_matching_tolerates_garbage() {
        assert!(orphan_pids("", "/x/node").is_empty());
        assert!(orphan_pids("not a table\n  \nzz yy xx\n", "/x/node").is_empty());
    }

    /// A group id nobody is using must read as dead rather than erroring.
    #[cfg(unix)]
    #[test]
    fn an_unknown_group_is_not_alive() {
        assert!(!group_is_alive(0x7FFF_FFF0));
    }

    /// Teardown of an already-dead process must not panic or hang.
    #[cfg(unix)]
    #[tokio::test]
    async fn terminating_a_finished_process_is_harmless() {
        let mut cmd = tokio::process::Command::new("/bin/sh");
        cmd.arg("-c").arg("exit 0");
        lead_new_group(&mut cmd);
        let mut child = cmd.spawn().expect("spawn");
        let pid = child.id().expect("pid");
        child.wait().await.expect("wait");

        let start = std::time::Instant::now();
        terminate_group(pid, Duration::from_millis(500));
        assert!(start.elapsed() < Duration::from_millis(700));
    }
}
