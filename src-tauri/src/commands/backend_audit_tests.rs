// Backend audit tests — TDD verification of suspected bugs.
//
// These tests exist to falsify the hypotheses in
// docs/backend-audit-findings.md. When a test passes, the hypothesis it
// targeted is either confirmed-as-designed or disproven. The doc is then
// updated to match what the code actually does.
//
// This module is included from commands/mod.rs via:
//   #[cfg(test)] mod backend_audit_tests;
//
// Within this context, `super::` refers to the `commands` module, so types
// from sibling modules are reached as `super::thread_db::XXX`.
//
// NOTE: This file must have `#![allow(unused_imports)]` at crate level or
// the imports must be actually used. Currently the imports are used inside
// the `audit_tests` module.

#[cfg(test)]
mod audit_tests {
    use crate::thread_db::{dedupe_key, DbMessage, DbThread, ThreadDatabase};
    use tokio::sync::mpsc;

    // ── Hypothesis A: terminate_group_of(None) is reachable ──────────────
    //
    // Claim (audit doc §1): when `child.id()` returns None at spawn time,
    // `pid_slot` stays 0 and `terminate_group_of` does nothing, leaking the
    // process group. The consequence is real — that is exactly the shape of
    // the orphaned-agent incident — so the question is only whether the
    // trigger can occur.
    //
    // `connection.rs` calls `child.id()` on the statement after `spawn()`,
    // with no await between them. Tokio returns None only once the child has
    // been reaped, which needs `wait()` to be polled; with no yield point in
    // between, nothing can reap it first. These tests use
    // `tokio::process::Command` — the type production actually spawns — and
    // include a process that exits immediately, which is the worst case for
    // "already gone by the time we ask".

    #[tokio::test]
    async fn child_id_is_some_right_after_spawn() {
        let mut child = tokio::process::Command::new("true")
            .spawn()
            .expect("spawn failed");
        assert!(
            child.id().is_some(),
            "pid must be readable on the statement after spawn — if this ever fails, \
             pid_slot stays 0 and the process group leaks"
        );
        let _ = child.wait().await;
    }

    /// The worst case: a process that has certainly exited by now.
    #[tokio::test]
    async fn child_id_survives_a_process_that_exits_immediately() {
        let mut child = tokio::process::Command::new("true")
            .spawn()
            .expect("spawn failed");
        // Give the child every chance to exit before we ask.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(
            child.id().is_some(),
            "an exited-but-unreaped child still reports its pid; None means reaped"
        );
        let _ = child.wait().await;
    }

    /// And the other side of it: after `wait()`, the pid is gone. This is why
    /// `connection.rs` copies it into `child_pid` up front instead of asking
    /// the `Child` again at teardown.
    #[tokio::test]
    async fn child_id_is_none_once_reaped() {
        let mut child = tokio::process::Command::new("true")
            .spawn()
            .expect("spawn failed");
        let before = child.id();
        let _ = child.wait().await;
        assert!(before.is_some());
        assert!(
            child.id().is_none(),
            "once reaped the pid is unavailable — the captured copy is the only one left"
        );
    }

    // ── Hypothesis B: does a CASCADE delete leave the FTS index behind? ──
    //
    // `thread_db.rs` claimed "ON DELETE CASCADE does not fire row-level
    // triggers", and `delete_thread` deletes messages explicitly first so the
    // AFTER DELETE trigger can clean the FTS index.
    //
    // Measured: it does fire. The claim was wrong and has been corrected.
    //
    // An earlier version of this test asked `search_messages`. That query
    // JOINs `messages_fts` against `messages` and `threads`, both of which a
    // cascade removes — so it returned empty either way and could not tell
    // apart the two outcomes it existed to distinguish. This one counts rows
    // in `messages_fts` directly.

    /// Run a scalar query through the writer connection.
    ///
    /// `read` is private and `write` hands out a `&Connection`, so this
    /// borrows the write path to ask a read-only question rather than
    /// widening production visibility for a test's convenience.
    async fn scalar(db: &ThreadDatabase, sql: &'static str) -> i64 {
        let out = std::sync::Arc::new(std::sync::Mutex::new(0i64));
        let sink = std::sync::Arc::clone(&out);
        db.write(move |conn| {
            let n: i64 = conn.query_row(sql, [], |row| row.get(0))?;
            *sink.lock().unwrap() = n;
            Ok(())
        })
        .await
        .expect("query");
        let n = *out.lock().unwrap();
        n
    }

    #[tokio::test]
    async fn cascade_delete_also_clears_the_fts_index() {
        let db = ThreadDatabase::open_memory().expect("open memory db");

        let thread = DbThread {
            id: "fts-cascade-test".to_string(),
            name: "FTS Cascade Test".to_string(),
            workspace: "/tmp".to_string(),
            status: "idle".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            parent_thread_id: None,
            auto_approve: false,
            metadata: None,
            message_count: 0,
        };
        db.save_thread(&thread).await.expect("save thread");

        let msg = DbMessage {
            id: 0,
            thread_id: "fts-cascade-test".to_string(),
            role: "user".to_string(),
            content: "this is a test message for cascade".to_string(),
            timestamp: "2024-01-01T00:00:01Z".to_string(),
            thinking: None,
            tool_calls: None,
        };
        db.save_message(&msg).await.expect("save message");

        assert_eq!(
            scalar(&db, "SELECT count(*) FROM messages_fts WHERE messages_fts MATCH 'cascade'").await,
            1,
            "the insert trigger should have indexed the message"
        );

        // Delete ONLY the thread. This is deliberately not what production
        // does — `delete_thread` removes messages first — because the whole
        // question is what CASCADE alone leaves behind.
        db.write(move |conn| {
            conn.execute("DELETE FROM threads WHERE id = ?1", ["fts-cascade-test"])?;
            Ok(())
        })
        .await
        .expect("cascade delete");

        assert_eq!(
            scalar(&db, "SELECT count(*) FROM messages WHERE thread_id = 'fts-cascade-test'").await,
            0,
            "the cascade itself must have run, or this test is measuring nothing"
        );

        assert_eq!(
            scalar(&db, "SELECT count(*) FROM messages_fts WHERE messages_fts MATCH 'cascade'").await,
            0,
            "the cascade fires the AFTER DELETE trigger on messages, so the FTS row goes with it"
        );
    }

    /// Pin the conditions the result above depends on.
    ///
    /// A cascade firing the trigger is the behaviour of *this* SQLite, under
    /// *these* pragmas. Recording both means a future reader can tell whether
    /// a change in behaviour came from the schema or from under it.
    #[tokio::test]
    async fn the_conditions_the_cascade_result_depends_on() {
        let db = ThreadDatabase::open_memory().expect("open");
        let out = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let sink = std::sync::Arc::clone(&out);
        db.write(move |conn| {
            let version: String = conn.query_row("SELECT sqlite_version()", [], |r| r.get(0))?;
            let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;
            let recursive: i64 = conn.query_row("PRAGMA recursive_triggers", [], |r| r.get(0))?;
            *sink.lock().unwrap() = format!("sqlite={version} foreign_keys={fk} recursive_triggers={recursive}");
            Ok(())
        })
        .await
        .expect("pragmas");
        let conditions = out.lock().unwrap().clone();
        println!("cascade/trigger conditions: {conditions}");
        // foreign_keys must be on or the cascade never happens and the test
        // above proves nothing.
        assert!(conditions.contains("foreign_keys=1"), "{conditions}");
    }

    /// The production path, for contrast: it must leave nothing behind.
    #[tokio::test]
    async fn delete_thread_clears_the_fts_index() {
        let db = ThreadDatabase::open_memory().expect("open memory db");
        let thread = DbThread {
            id: "fts-explicit-test".to_string(),
            name: "FTS Explicit Test".to_string(),
            workspace: "/tmp".to_string(),
            status: "idle".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            parent_thread_id: None,
            auto_approve: false,
            metadata: None,
            message_count: 0,
        };
        db.save_thread(&thread).await.expect("save thread");
        db.save_message(&DbMessage {
            id: 0,
            thread_id: "fts-explicit-test".to_string(),
            role: "user".to_string(),
            content: "another test message for cascade".to_string(),
            timestamp: "2024-01-01T00:00:01Z".to_string(),
            thinking: None,
            tool_calls: None,
        })
        .await
        .expect("save message");

        db.delete_thread("fts-explicit-test").await.expect("delete thread");

        assert_eq!(
            scalar(&db, "SELECT count(*) FROM messages_fts WHERE messages_fts MATCH 'cascade'").await,
            0,
            "delete_thread must leave no orphaned FTS rows"
        );
    }

    // ── Hypothesis C: dedupe_key distinguishes same-second different-ms ──
    //
    // Claim (audit doc §3): "two genuinely distinct sends collide only when
    // they carry identical content, role, thread, AND the same millisecond."
    //
    // We test both directions: different ms → different keys, identical
    // everything → same key and INSERT OR IGNORE collapses the second.

    #[tokio::test]
    async fn dedupe_key_distinguishes_same_second_different_ms() {
        let msg1 = DbMessage {
            id: 0,
            thread_id: "t1".to_string(),
            role: "user".to_string(),
            content: "continue".to_string(),
            timestamp: "2024-01-01T00:00:01.100Z".to_string(),
            thinking: None,
            tool_calls: None,
        };
        let msg2 = DbMessage {
            id: 0,
            thread_id: "t1".to_string(),
            role: "user".to_string(),
            content: "continue".to_string(),
            timestamp: "2024-01-01T00:00:01.101Z".to_string(),
            thinking: None,
            tool_calls: None,
        };

        let key1 = dedupe_key(&msg1);
        let key2 = dedupe_key(&msg2);

        assert_ne!(
            key1, key2,
            "Same content, same second, different ms must produce different keys"
        );
    }

    #[tokio::test]
    async fn dedupe_key_collapses_identical_messages() {
        let db = ThreadDatabase::open_memory().expect("open");

        // Thread must exist before messages can be inserted (FK constraint).
        let thread = DbThread {
            id: "t1".to_string(),
            name: "Dedup Test".to_string(),
            workspace: "/tmp".to_string(),
            status: "idle".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            parent_thread_id: None,
            auto_approve: false,
            metadata: None,
            message_count: 0,
        };
        db.save_thread(&thread).await.expect("save thread");

        let msg1 = DbMessage {
            id: 0,
            thread_id: "t1".to_string(),
            role: "user".to_string(),
            content: "continue".to_string(),
            timestamp: "2024-01-01T00:00:01.100Z".to_string(),
            thinking: None,
            tool_calls: None,
        };
        let msg2 = DbMessage {
            id: 0,
            thread_id: "t1".to_string(),
            role: "user".to_string(),
            content: "continue".to_string(),
            timestamp: "2024-01-01T00:00:01.100Z".to_string(),
            thinking: None,
            tool_calls: None,
        };

        let key1 = dedupe_key(&msg1);
        let key2 = dedupe_key(&msg2);

        assert_eq!(
            key1, key2,
            "Identical messages (including same ms) must produce the same key"
        );

        let id1 = db.save_message(&msg1).await.expect("save msg1");
        let id2 = db.save_message(&msg2).await.expect("save msg2");

        assert_eq!(
            id1, id2,
            "Second insert should return the existing row id"
        );

        let messages = db.load_messages("t1").await.expect("load");
        assert_eq!(
            messages.len(),
            1,
            "Only one message should be stored"
        );
    }

    // ── Hypothesis D: analytics_prune extract_from_if range boundary ─────
    //
    // Claim (audit doc §4): `extract_from_if(..cutoff_key, ...)` may be
    // half-open or closed, and events AT the cutoff key might be wrongly
    // included or excluded.
    //
    // redb 2.6: `extract_from_if` takes `range::Bounds`. The `..cutoff_key`
    // syntax is `RangeToExclusive`, meaning keys < cutoff_key are extracted.
    // Events AT cutoff_key are NOT extracted. This is the correct behavior
    // for a "prune older than" operation.
    //
    // We test this by writing events at specific keys and checking which
    // ones get pruned. Uses redb directly (not analytics.rs) to isolate the
    // primitive.

    #[test]
    fn redb_range_to_exclusive_excludes_the_boundary_key() {
        use redb::{Database, TableDefinition};

        const TABLE: TableDefinition<u64, u64> = TableDefinition::new("test");

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("range-test.redb");
        let db = Database::create(&path).unwrap();

        // Write events at keys: 100, 200, 300
        {
            let txn = db.begin_write().unwrap();
            let mut table = txn.open_table(TABLE).unwrap();
            table.insert(100, 100).unwrap();
            table.insert(200, 200).unwrap();
            table.insert(300, 300).unwrap();
            drop(table);
            txn.commit().unwrap();
        }

        // Query with range ..200 (exclusive upper bound): should return only 100
        {
            let keys: Vec<u64> = {
                let txn = db.begin_read().unwrap();
                let table = txn.open_table(TABLE).unwrap();
                table
                    .range(..200)
                    .unwrap()
                    .filter_map(|entry| {
                        entry.ok().map(|(k, _v)| k.value().clone())
                    })
                    .collect()
            };
            assert_eq!(
                keys, vec![100],
                "range(..cutoff) should return only keys strictly less than cutoff"
            );
        }

        // Query with range 200.. (inclusive lower bound): should return 200, 300
        {
            let keys: Vec<u64> = {
                let txn = db.begin_read().unwrap();
                let table = txn.open_table(TABLE).unwrap();
                table
                    .range(200..)
                    .unwrap()
                    .filter_map(|entry| {
                        entry.ok().map(|(k, _v)| k.value().clone())
                    })
                    .collect()
            };
            assert_eq!(
                keys, vec![200, 300],
                "range(cutoff..) should return keys >= cutoff"
            );
        }
    }

    // ── Hypothesis E: task_send_message race ─────────────────────────────
    //
    // Claim (audit doc §5): the liveness check and the send are not atomic,
    // so the child can die between them and the send fails without a clear
    // error.
    //
    // The premise holds: `UnboundedSender::send` does report a dropped
    // receiver. (An earlier version of the first test below drained the
    // channel with `rx.recv().await` before dropping it — on an empty channel
    // with a live sender that waits forever, so the suite never finished and
    // the assertion was never reached.)
    //
    // What that leaves is a question about the caller, not the channel: does
    // `task_send_message` look at the result? The live-connection branch does.
    // The reconnect branch discarded it with `let _ =` until this audit; both
    // now report the failure.
    //
    // Note what a successful send still does not promise. The queue outlives
    // nothing: if the connection task fails after this message is queued, the
    // message dies in the buffer with it. Ok means "handed over", not
    // "delivered" — the delivery guarantee comes from `alive` flipping and the
    // watchdog, not from the send.

    #[tokio::test]
    async fn unbounded_sender_send_fails_when_receiver_is_dropped() {
        let (tx, rx) = mpsc::unbounded_channel::<String>();
        // No drain here. `recv()` on an empty channel whose sender is still
        // alive waits for the next message — forever, in a test that never
        // sends one. That single line is what hung this suite: the process
        // never exited, so `cargo test` reported a timeout rather than a
        // result, and the assertion below was never reached.
        drop(rx);

        let result = tx.send("test".to_string());
        assert!(
            result.is_err(),
            "Sending on an unbounded channel with dropped receiver should fail"
        );
    }

    #[tokio::test]
    async fn unbounded_sender_send_succeeds_with_live_receiver() {
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();

        let send_result = tx.send("test".to_string());
        assert!(send_result.is_ok(), "Send should succeed with live receiver");

        let received = rx.recv().await.unwrap();
        assert_eq!(received, "test");
    }
}
