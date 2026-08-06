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
