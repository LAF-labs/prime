use super::*;
use super::connection::{build_prompt_payload, refine_status_payload, strip_image_tags};

// ── is_within_workspace: allowed paths ──────────────────────────


// ── is_within_workspace: blocked paths ──────────────────────────

// ── is_within_workspace: edge cases ─────────────────────────────

// ── extract_paths_from_message ──────────────────────────────────

// ── is_path_allowed ─────────────────────────────────────────────

// ── is_path_strictly_allowed ────────────────────────────────────

// ── extract_paths_from_json ───────────────────────────────────

// ── is_path_strictly_allowed: edge cases + security ─────────────

// ── extract_paths_from_json: edge cases ─────────────────────────

// ── loose vs strict comparison ──────────────────────────────────

// ── Performance benchmarks ──────────────────────────────────────

// ── Memory consumption tests ────────────────────────────────────

// ── refine_status translation ───────────────────────────────────

#[test]
fn refine_complete_counts_only_applied_edits() {
    let event = serde_json::json!({
        "type": "refine_complete",
        "result": { "appliedEdits": [
            { "applied": true, "action": "add", "kind": "rule", "id": "a" },
            { "applied": false, "action": "add", "kind": "rule", "id": "b" },
            { "applied": true, "action": "update", "kind": "rule", "id": "c" },
        ]},
    });
    let payload = refine_status_payload("t1", &event);
    assert_eq!(payload["status"], "completed");
    assert_eq!(payload["appliedCount"], 2);
    assert_eq!(payload["taskId"], "t1");
}

#[test]
fn refine_complete_with_no_edits_reports_zero() {
    let event = serde_json::json!({ "type": "refine_complete" });
    let payload = refine_status_payload("t1", &event);
    assert_eq!(payload["status"], "completed");
    assert_eq!(payload["appliedCount"], 0);
}

#[test]
fn refine_failed_carries_the_error() {
    let event = serde_json::json!({ "type": "refine_failed", "error": "no evidence found" });
    let payload = refine_status_payload("t1", &event);
    assert_eq!(payload["status"], "failed");
    assert_eq!(payload["error"], "no evidence found");
}

// ── Settings integration tests ──────────────────────────────────
#[test]
fn tight_sandbox_roundtrip_false() {
    let prefs = crate::commands::settings::ProjectPrefs {
        tight_sandbox: Some(false),
        ..Default::default()
    };
    let json = serde_json::to_string(&prefs).unwrap();
    assert!(json.contains("tightSandbox"));
    let restored: crate::commands::settings::ProjectPrefs = serde_json::from_str(&json).unwrap();
    assert_eq!(restored.tight_sandbox, Some(false));
}

#[test]
fn tight_sandbox_unwrap_or_true_when_none() {
    let prefs = crate::commands::settings::ProjectPrefs::default();
    let effective = prefs.tight_sandbox.unwrap_or(true);
    assert!(effective);
}

#[test]
fn tight_sandbox_unwrap_or_true_when_some_false() {
    let prefs = crate::commands::settings::ProjectPrefs {
        tight_sandbox: Some(false),
        ..Default::default()
    };
    let effective = prefs.tight_sandbox.unwrap_or(true);
    assert!(!effective);
}

#[test]
fn tight_sandbox_in_full_settings_roundtrip() {
    let mut prefs_map = std::collections::HashMap::new();
    prefs_map.insert("/Users/me/project".to_string(), crate::commands::settings::ProjectPrefs {
        tight_sandbox: Some(false),
        model_id: Some("claude-4".to_string()),
        ..Default::default()
    });
    prefs_map.insert("/Users/me/other".to_string(), crate::commands::settings::ProjectPrefs {
        tight_sandbox: Some(true),
        ..Default::default()
    });
    let settings = crate::commands::settings::AppSettings {
        project_prefs: Some(prefs_map),
        ..Default::default()
    };
    let json = serde_json::to_string(&settings).unwrap();
    let restored: crate::commands::settings::AppSettings = serde_json::from_str(&json).unwrap();
    let pp = restored.project_prefs.unwrap();
    assert_eq!(pp["/Users/me/project"].tight_sandbox, Some(false));
    assert_eq!(pp["/Users/me/other"].tight_sandbox, Some(true));
}


// ── friendly_prompt_error ───────────────────────────────────────

// ── auto_approve AtomicBool sharing ─────────────────────────────
#[test]
fn auto_approve_atomic_shared_between_handle_and_client() {
    let flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let handle_copy = flag.clone();
    let client_copy = flag.clone();
    assert!(!client_copy.load(std::sync::atomic::Ordering::SeqCst));
    handle_copy.store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(client_copy.load(std::sync::atomic::Ordering::SeqCst));
}

#[test]
fn auto_approve_atomic_toggle_back_and_forth() {
    let flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
    let a = flag.clone();
    let b = flag.clone();
    assert!(b.load(std::sync::atomic::Ordering::SeqCst));
    a.store(false, std::sync::atomic::Ordering::SeqCst);
    assert!(!b.load(std::sync::atomic::Ordering::SeqCst));
    a.store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(b.load(std::sync::atomic::Ordering::SeqCst));
}

#[test]
fn auto_approve_atomic_cross_thread_visibility() {
    let flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let writer = flag.clone();
    let reader = flag.clone();
    let handle = std::thread::spawn(move || {
        writer.store(true, std::sync::atomic::Ordering::SeqCst);
    });
    handle.join().unwrap();
    assert!(reader.load(std::sync::atomic::Ordering::SeqCst));
}

// ── Task serialization with auto_approve ────────────────────────

#[test]
fn task_serializes_auto_approve_true() {
    let task = Task {
        id: "t1".into(),
        name: "test".into(),
        workspace: "/ws".into(),
        status: "running".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
        messages: vec![],
        pending_permission: None,
        plan: None,
        context_usage: None,
        auto_approve: Some(true),
        user_paused: None,
        parent_task_id: None,
        session_file: None,
        launch_options: None,
    };
    let json = serde_json::to_value(&task).unwrap();
    assert_eq!(json["autoApprove"], true);
}

#[test]
fn task_serializes_auto_approve_false() {
    let task = Task {
        id: "t2".into(),
        name: "test".into(),
        workspace: "/ws".into(),
        status: "running".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
        messages: vec![],
        pending_permission: None,
        plan: None,
        context_usage: None,
        auto_approve: Some(false),
        user_paused: None,
        parent_task_id: None,
        session_file: None,
        launch_options: None,
    };
    let json = serde_json::to_value(&task).unwrap();
    assert_eq!(json["autoApprove"], false);
}

#[test]
fn task_omits_auto_approve_when_none() {
    let task = Task {
        id: "t3".into(),
        name: "test".into(),
        workspace: "/ws".into(),
        status: "running".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
        messages: vec![],
        pending_permission: None,
        plan: None,
        context_usage: None,
        auto_approve: None,
        user_paused: None,
        parent_task_id: None,
        session_file: None,
        launch_options: None,
    };
    let json = serde_json::to_value(&task).unwrap();
    assert!(json.get("autoApprove").is_none());
}

#[test]
fn task_auto_approve_roundtrip() {
    let task = Task {
        id: "t4".into(),
        name: "roundtrip".into(),
        workspace: "/ws".into(),
        status: "running".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
        messages: vec![],
        pending_permission: None,
        plan: None,
        context_usage: None,
        auto_approve: Some(true),
        user_paused: None,
        parent_task_id: None,
        session_file: None,
        launch_options: None,
    };
    let json_str = serde_json::to_string(&task).unwrap();
    let restored: Task = serde_json::from_str(&json_str).unwrap();
    assert_eq!(restored.auto_approve, Some(true));
}

// ── strip_image_tags (fix #14) ──────────────────────────────────

#[test]
fn strip_image_tags_removes_attached_image_block() {
    let input = "Hello\n[Attached image: pic.png (image/png, 100 bytes)]\n<image src=\"data:image/png;base64,abc123\" />\nWorld";
    let result = strip_image_tags(input);
    assert_eq!(result, "Hello\nWorld");
}

#[test]
fn strip_image_tags_removes_standalone_image_tag() {
    let input = "Check this: <image src=\"data:image/jpeg;base64,xyz789\" /> done";
    let result = strip_image_tags(input);
    assert_eq!(result, "Check this:  done");
}

#[test]
fn strip_image_tags_preserves_text_without_images() {
    let input = "No images here, just text.";
    let result = strip_image_tags(input);
    assert_eq!(result, input);
}

#[test]
fn strip_image_tags_handles_multiple_images() {
    let input = "<image src=\"data:image/png;base64,aaa\" />\ntext\n<image src=\"data:image/jpg;base64,bbb\" />";
    let result = strip_image_tags(input);
    assert_eq!(result, "text");
}

#[test]
fn strip_image_tags_handles_empty_string() {
    assert_eq!(strip_image_tags(""), "");
}

/// Every test above is ASCII, which is how a byte-by-byte copy survived here:
/// it reinterpreted each UTF-8 byte as a Latin-1 code point, so attaching a
/// screenshot to a Korean prompt sent the model mojibake.
#[test]
fn strip_image_tags_keeps_non_ascii_text_intact() {
    let input = "안녕하세요, 이 스크린샷을 봐주세요 🙏";
    assert_eq!(strip_image_tags(input), input);
}

#[test]
fn strip_image_tags_keeps_non_ascii_around_a_stripped_image() {
    let input = "이 이미지를 확인해 주세요\n[Attached image: 화면.png (image/png, 100 bytes)]\n<image src=\"data:image/png;base64,abc123\" />\n고맙습니다 🙇";
    assert_eq!(
        strip_image_tags(input),
        "이 이미지를 확인해 주세요\n고맙습니다 🙇"
    );
}

// ── truncate_chars ──────────────────────────────────────────────

/// `&text[..120]` panics when byte 120 lands inside a character, which took
/// out the stderr reader — and with it every diagnostic for that session.
#[test]
fn truncating_never_splits_a_character() {
    let korean = "가".repeat(200); // 3 bytes each: byte 120 is a boundary, 121 is not
    let cut = super::connection::truncate_chars(&korean, 120);
    assert_eq!(cut.chars().count(), 120);

    let emoji = "🙂".repeat(100); // 4 bytes each
    assert_eq!(super::connection::truncate_chars(&emoji, 40).chars().count(), 40);

    let mixed = "ab가🙂";
    assert_eq!(super::connection::truncate_chars(mixed, 3), "ab가");
}

#[test]
fn truncating_returns_short_text_unchanged() {
    assert_eq!(super::connection::truncate_chars("짧다", 120), "짧다");
    assert_eq!(super::connection::truncate_chars("", 10), "");
}

// ── build_prompt_payload ────────────────────────────────────────

#[test]
fn build_prompt_payload_text_only() {
    let payload = build_prompt_payload("hello".to_string(), &[], false);
    assert_eq!(payload["type"], "prompt");
    assert_eq!(payload["message"], "hello");
    assert!(payload.get("images").is_none());
    assert!(payload.get("streamingBehavior").is_none());
}

#[test]
fn build_prompt_payload_with_attachments() {
    let atts = vec![
        AttachmentData { base64: "abc".to_string(), mime_type: "image/png".to_string(), name: Some("pic.png".to_string()) },
    ];
    let payload = build_prompt_payload(
        "hello <image src=\"data:image/png;base64,abc\" />".to_string(),
        &atts,
        false,
    );
    assert_eq!(payload["message"], "hello");
    let images = payload["images"].as_array().unwrap();
    assert_eq!(images.len(), 1);
    assert_eq!(images[0]["data"], "abc");
    assert_eq!(images[0]["mimeType"], "image/png");
}

#[test]
fn build_prompt_payload_steer_flag() {
    let payload = build_prompt_payload("go".to_string(), &[], true);
    assert_eq!(payload["streamingBehavior"], "steer");
}

// ── RPC model mapping ───────────────────────────────────────────

#[test]
fn map_model_composite_id() {
    let m = serde_json::json!({
        "id": "claude-sonnet-4", "name": "Claude Sonnet 4", "provider": "anthropic"
    });
    let mapped = connection::map_model(&m).unwrap();
    assert_eq!(mapped["modelId"], "anthropic/claude-sonnet-4");
    assert_eq!(mapped["name"], "Claude Sonnet 4");
    assert_eq!(mapped["description"], "anthropic");
}

#[test]
fn composite_model_id_roundtrip() {
    let m = serde_json::json!({ "id": "gpt-5", "provider": "openai" });
    assert_eq!(connection::composite_model_id(&m).unwrap(), "openai/gpt-5");
}

#[test]
fn tool_title_and_kind_mapping() {
    let args = serde_json::json!({ "command": "ls -la" });
    assert_eq!(connection::tool_title("bash", &args), "bash: ls -la");
    assert_eq!(connection::tool_kind("bash"), "execute");
    assert_eq!(connection::tool_kind("edit"), "edit");
    assert_eq!(connection::tool_kind("read"), "read");
    assert_eq!(connection::tool_kind("mystery"), "other");
}

/// `tool_title` used to call `String::truncate(200)`, which slices at a byte
/// index and panics when byte 200 lands inside a multi-byte character — any
/// long Korean command or path did exactly that.
#[test]
fn tool_title_truncates_long_korean_titles_without_panicking() {
    // "가" is 3 bytes: the "bash: " prefix (6 bytes) plus 64 chars puts byte
    // 200 mid-character, the exact panic case.
    let command = "가".repeat(300);
    let args = serde_json::json!({ "command": command });
    let title = connection::tool_title("bash", &args);
    assert!(title.ends_with('…'));
    assert_eq!(title.chars().count(), 201); // 200 kept + ellipsis
    assert!(title.starts_with("bash: 가"));
}

// ── AttachmentData deserialization (fix #14) ─────────────────────

#[test]
fn attachment_data_deserializes_from_camel_case() {
    let json = r#"{"base64":"abc123","mimeType":"image/png","name":"pic.png"}"#;
    let att: AttachmentData = serde_json::from_str(json).unwrap();
    assert_eq!(att.base64, "abc123");
    assert_eq!(att.mime_type, "image/png");
    assert_eq!(att.name, Some("pic.png".to_string()));
}

#[test]
fn attachment_data_deserializes_without_name() {
    let json = r#"{"base64":"xyz","mimeType":"image/jpeg"}"#;
    let att: AttachmentData = serde_json::from_str(json).unwrap();
    assert_eq!(att.base64, "xyz");
    assert_eq!(att.mime_type, "image/jpeg");
    assert_eq!(att.name, None);
}

// ── build_resumption_preamble + sanitize_forked_messages ───────────────

fn make_msg(role: &str, content: &str) -> TaskMessage {
    TaskMessage {
        role: role.to_string(),
        content: content.to_string(),
        timestamp: "2024-01-01T00:00:00Z".to_string(),
        tool_calls: None,
        tool_call_splits: None,
        thinking: None,
    }
}

#[test]
fn preamble_empty_for_no_messages() {
    let preamble = build_resumption_preamble(&[], "Forked conversation", "intro");
    assert!(preamble.is_empty());
}

#[test]
fn preamble_includes_header_intro_and_transcript() {
    let msgs = vec![
        make_msg("user", "hello"),
        make_msg("assistant", "hi there"),
    ];
    let preamble = build_resumption_preamble(&msgs, "Forked conversation", "Forked intro line.");
    assert!(preamble.contains("## Forked conversation"));
    assert!(preamble.contains("Forked intro line."));
    assert!(preamble.contains("user: hello"));
    assert!(preamble.contains("assistant: hi there"));
    assert!(preamble.ends_with("## New message\n\n"));
}

#[test]
fn preamble_skips_empty_and_non_user_assistant_roles() {
    let msgs = vec![
        make_msg("user", "real message"),
        make_msg("system", "should be skipped"),
        make_msg("assistant", ""),
        make_msg("assistant", "real reply"),
    ];
    let preamble = build_resumption_preamble(&msgs, "Resumed conversation", "intro");
    assert!(preamble.contains("user: real message"));
    assert!(preamble.contains("assistant: real reply"));
    assert!(!preamble.contains("should be skipped"));
}

#[test]
fn preamble_empty_when_all_messages_filtered_out() {
    // All messages are either empty content or non-user/assistant roles —
    // the transcript body would be empty, so the whole preamble should be
    // empty rather than emitting a header with a blank transcript block.
    let msgs = vec![
        make_msg("system", "system note"),
        make_msg("user", ""),
        make_msg("assistant", "   "),
        make_msg("tool", "tool output"),
    ];
    let preamble = build_resumption_preamble(&msgs, "Resumed conversation", "intro");
    assert!(preamble.is_empty());
}

#[test]
fn preamble_truncates_when_byte_budget_exceeded() {
    // One huge message followed by recent small messages — only recent should be kept.
    let big = "x".repeat(RESUMPTION_BYTE_BUDGET + 100);
    let msgs = vec![
        make_msg("user", &big),
        make_msg("assistant", "recent reply 1"),
        make_msg("user", "recent question"),
    ];
    let preamble = build_resumption_preamble(&msgs, "Forked conversation", "intro");
    assert!(preamble.contains("recent question"));
    assert!(preamble.contains("recent reply 1"));
    assert!(!preamble.contains(&big));
    assert!(preamble.contains("older context omitted"));
}

#[test]
fn preamble_truncates_when_message_count_exceeded() {
    let msgs: Vec<TaskMessage> = (0..(RESUMPTION_MAX_MESSAGES + 5))
        .map(|i| make_msg("user", &format!("msg-{i:03}")))
        .collect();
    let preamble = build_resumption_preamble(&msgs, "Resumed conversation", "intro");
    // The earliest messages should be dropped (oldest 5 of 45).
    assert!(!preamble.contains("msg-000"));
    assert!(!preamble.contains("msg-004"));
    // The boundary message should be kept.
    assert!(preamble.contains("msg-005"));
    // The most recent message survives.
    assert!(preamble.contains(&format!("msg-{:03}", RESUMPTION_MAX_MESSAGES + 4)));
    assert!(preamble.contains("older context omitted"));
}

#[test]
fn sanitize_normalizes_in_progress_tool_calls() {
    let mut msgs = vec![TaskMessage {
        role: "assistant".to_string(),
        content: "working on it".to_string(),
        timestamp: "t".to_string(),
        thinking: None,
        tool_call_splits: None,
        tool_calls: Some(vec![
            ToolCallData {
                tool_call_id: "tc-1".to_string(),
                title: "edit file".to_string(),
                status: "in_progress".to_string(),
                kind: None, locations: None, content: None, raw_input: None, raw_output: None, created_at: None, completed_at: None,
            },
            ToolCallData {
                tool_call_id: "tc-2".to_string(),
                title: "read file".to_string(),
                status: "pending".to_string(),
                kind: None, locations: None, content: None, raw_input: None, raw_output: None, created_at: None, completed_at: None,
            },
            ToolCallData {
                tool_call_id: "tc-3".to_string(),
                title: "shell".to_string(),
                status: "completed".to_string(),
                kind: None, locations: None, content: None, raw_input: None, raw_output: None, created_at: None, completed_at: None,
            },
            ToolCallData {
                tool_call_id: "tc-4".to_string(),
                title: "run".to_string(),
                status: "failed".to_string(),
                kind: None, locations: None, content: None, raw_input: None, raw_output: None, created_at: None, completed_at: None,
            },
        ]),
    }];
    sanitize_forked_messages(&mut msgs);
    let calls = msgs[0].tool_calls.as_ref().unwrap();
    assert_eq!(calls[0].status, "cancelled"); // in_progress => cancelled
    assert_eq!(calls[1].status, "cancelled"); // pending => cancelled
    assert_eq!(calls[2].status, "completed"); // terminal preserved
    assert_eq!(calls[3].status, "failed");    // terminal preserved
    // Title and id preserved.
    assert_eq!(calls[0].title, "edit file");
    assert_eq!(calls[0].tool_call_id, "tc-1");
}

#[test]
fn sanitize_leaves_messages_without_tool_calls_untouched() {
    let mut msgs = vec![make_msg("user", "hi")];
    sanitize_forked_messages(&mut msgs);
    assert!(msgs[0].tool_calls.is_none());
}

// ── existing_messages round-trip (resumption keeps tool history) ────────

#[test]
fn existing_messages_round_trip_keeps_tool_calls_and_splits() {
    // Exactly the shape ChatPanel sends in `existingMessages` on resumption:
    // camelCase keys, tool calls with timestamps, and inline split anchors.
    let json = r#"[
        {
            "role": "assistant",
            "content": "Editing the file now.",
            "timestamp": "2026-01-01T00:00:00Z",
            "toolCalls": [
                {
                    "toolCallId": "tc-1",
                    "title": "Edit main.rs",
                    "status": "completed",
                    "kind": "edit",
                    "createdAt": "2026-01-01T00:00:01Z",
                    "completedAt": "2026-01-01T00:00:02Z"
                }
            ],
            "toolCallSplits": [{ "at": 8, "toolCallId": "tc-1" }]
        }
    ]"#;
    let msgs: Vec<TaskMessage> = serde_json::from_str(json).unwrap();
    assert_eq!(msgs.len(), 1);

    let calls = msgs[0].tool_calls.as_ref().expect("toolCalls must survive");
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].tool_call_id, "tc-1");
    assert_eq!(calls[0].status, "completed");
    assert_eq!(calls[0].created_at.as_deref(), Some("2026-01-01T00:00:01Z"));
    assert_eq!(calls[0].completed_at.as_deref(), Some("2026-01-01T00:00:02Z"));

    let splits = msgs[0].tool_call_splits.as_ref().expect("toolCallSplits must survive");
    assert_eq!(splits.len(), 1);
    assert_eq!(splits[0].at, 8);
    assert_eq!(splits[0].tool_call_id, "tc-1");

    // And they flow back out camelCase on task_update serialization.
    let out = serde_json::to_value(&msgs[0]).unwrap();
    assert_eq!(out["toolCalls"][0]["toolCallId"], "tc-1");
    assert_eq!(out["toolCalls"][0]["createdAt"], "2026-01-01T00:00:01Z");
    assert_eq!(out["toolCallSplits"][0]["at"], 8);
    assert_eq!(out["toolCallSplits"][0]["toolCallId"], "tc-1");
}

#[test]
fn create_task_params_defer_spawn_defaults_false() {
    let json = r#"{"name":"t","workspace":"/tmp","prompt":"hi"}"#;
    let params: CreateTaskParams = serde_json::from_str(json).unwrap();
    assert!(!params.defer_spawn);
}

#[test]
fn create_task_params_defer_spawn_round_trips() {
    let json = r#"{"name":"t","workspace":"/tmp","prompt":"","deferSpawn":true}"#;
    let params: CreateTaskParams = serde_json::from_str(json).unwrap();
    assert!(params.defer_spawn);
}

// ── resolve_initial_model ──────────────────────────────────────────────

use crate::commands::settings::{AppSettings, ProjectPrefs};
use crate::commands::rpc::commands::resolve_initial_model;

fn make_settings(default_model: Option<&str>, project_model: Option<&str>, workspace: &str) -> AppSettings {
    let mut settings = AppSettings::default();
    settings.default_model = default_model.map(|s| s.to_string());
    if let Some(pm) = project_model {
        let mut prefs = std::collections::HashMap::new();
        prefs.insert(workspace.to_string(), ProjectPrefs {
            model_id: Some(pm.to_string()),
            ..Default::default()
        });
        settings.project_prefs = Some(prefs);
    }
    settings
}

#[test]
fn resolve_model_explicit_wins() {
    let settings = make_settings(Some("global-model"), Some("project-model"), "/ws");
    let result = resolve_initial_model(Some("explicit-model".to_string()), "/ws", &settings);
    assert_eq!(result, Some("explicit-model".to_string()));
}

#[test]
fn resolve_model_project_pref_over_global() {
    let settings = make_settings(Some("global-model"), Some("project-model"), "/ws");
    let result = resolve_initial_model(None, "/ws", &settings);
    assert_eq!(result, Some("project-model".to_string()));
}

#[test]
fn resolve_model_global_fallback() {
    let settings = make_settings(Some("global-model"), None, "/ws");
    let result = resolve_initial_model(None, "/ws", &settings);
    assert_eq!(result, Some("global-model".to_string()));
}

#[test]
fn resolve_model_none_when_nothing_set() {
    let settings = make_settings(None, None, "/ws");
    let result = resolve_initial_model(None, "/ws", &settings);
    assert_eq!(result, None);
}

#[test]
fn resolve_model_skips_empty_explicit() {
    let settings = make_settings(Some("global-model"), None, "/ws");
    let result = resolve_initial_model(Some("  ".to_string()), "/ws", &settings);
    assert_eq!(result, Some("global-model".to_string()));
}

#[test]
fn resolve_model_skips_empty_project_pref() {
    let mut settings = AppSettings::default();
    settings.default_model = Some("global-model".to_string());
    let mut prefs = std::collections::HashMap::new();
    prefs.insert("/ws".to_string(), ProjectPrefs {
        model_id: Some("".to_string()),
        ..Default::default()
    });
    settings.project_prefs = Some(prefs);
    let result = resolve_initial_model(None, "/ws", &settings);
    assert_eq!(result, Some("global-model".to_string()));
}

#[test]
fn resolve_model_different_workspace_ignores_project_pref() {
    let settings = make_settings(Some("global-model"), Some("project-model"), "/ws");
    let result = resolve_initial_model(None, "/other-ws", &settings);
    assert_eq!(result, Some("global-model".to_string()));
}

// ── RPC event translation ───────────────────────────────────────
//
// The connection layer is what turns prime-agent's RPC stream into the
// events the renderer consumes. These lock down the shapes the UI depends
// on, which nothing else in the suite covers.

#[test]
fn result_text_concatenates_only_text_blocks() {
    let result = serde_json::json!({
        "content": [
            { "type": "text", "text": "first" },
            { "type": "image", "data": "ignored" },
            { "type": "text", "text": "second" },
        ]
    });
    assert_eq!(connection::result_text(&result), "first\nsecond");
}

#[test]
fn result_text_is_empty_without_content() {
    assert_eq!(connection::result_text(&serde_json::json!({})), "");
}

#[test]
fn text_content_wraps_in_the_shape_the_ui_renders() {
    let v = connection::text_content("hello");
    assert_eq!(v[0]["type"], "content");
    assert_eq!(v[0]["content"]["type"], "text");
    assert_eq!(v[0]["content"]["text"], "hello");
}

#[test]
fn tool_title_falls_back_to_the_tool_name() {
    // No recognizable argument: the title must still identify the tool
    // rather than render as an empty row.
    assert_eq!(connection::tool_title("mystery", &serde_json::json!({})), "mystery");
    assert_eq!(connection::tool_title("bash", &serde_json::json!({ "command": "  " })), "bash");
}

#[test]
fn tool_title_truncates_long_commands() {
    let long = "x".repeat(500);
    let title = connection::tool_title("bash", &serde_json::json!({ "command": long }));
    assert!(title.chars().count() <= 201, "got {} chars", title.chars().count());
    assert!(title.ends_with('…'));
}

#[test]
fn tool_title_uses_the_first_line_of_an_ipython_cell() {
    let args = serde_json::json!({ "code": "import os\nprint(os.getcwd())" });
    assert_eq!(connection::tool_title("ipython", &args), "ipython: import os");
}

#[test]
fn tool_title_reads_any_of_the_path_argument_spellings() {
    for key in ["path", "file_path", "filePath"] {
        let args = serde_json::json!({ key: "/tmp/a.rs" });
        assert_eq!(connection::tool_title("edit", &args), "edit: /tmp/a.rs");
    }
}

#[test]
fn map_model_requires_an_id() {
    assert!(connection::map_model(&serde_json::json!({ "provider": "openai" })).is_none());
}

#[test]
fn map_model_defaults_an_unknown_provider() {
    let mapped = connection::map_model(&serde_json::json!({ "id": "m1" })).unwrap();
    assert_eq!(mapped["modelId"], "unknown/m1");
    // Name falls back to the id so the picker never shows a blank row.
    assert_eq!(mapped["name"], "m1");
}

#[test]
fn composite_model_id_needs_both_halves() {
    assert!(connection::composite_model_id(&serde_json::json!({ "id": "m" })).is_none());
    assert!(connection::composite_model_id(&serde_json::json!({ "provider": "p" })).is_none());
}

#[test]
fn agent_path_env_puts_the_sidecar_first() {
    // prime-agent finds uv by scanning PATH, so the bundled copy has to win
    // over any system install.
    let launch = crate::commands::agent_launch::AgentLaunch {
        program: "/Apps/LAF.app/Contents/Resources/resources/prime-agent/node".to_string(),
        prefix_args: vec![],
    };
    let path = crate::commands::agent_launch::agent_path_env(&launch);
    assert!(path.starts_with("/Apps/LAF.app/Contents/Resources/resources/prime-agent:"));
    assert!(path.contains("/usr/bin"));
}

#[test]
fn agent_path_env_survives_a_bare_program_name() {
    let launch = crate::commands::agent_launch::AgentLaunch {
        program: "prime-agent".to_string(),
        prefix_args: vec![],
    };
    let path = crate::commands::agent_launch::agent_path_env(&launch);
    assert!(path.starts_with("/opt/homebrew/bin:"));
}

#[test]
fn prompt_payload_carries_multiple_images() {
    let atts = vec![
        AttachmentData { base64: "a".into(), mime_type: "image/png".into(), name: None },
        AttachmentData { base64: "b".into(), mime_type: "image/jpeg".into(), name: None },
    ];
    let payload = build_prompt_payload("look".to_string(), &atts, true);
    let images = payload["images"].as_array().unwrap();
    assert_eq!(images.len(), 2);
    assert_eq!(images[1]["mimeType"], "image/jpeg");
    assert_eq!(payload["streamingBehavior"], "steer");
}

// ── Concurrent agent limit ──────────────────────────────────────

use super::commands::agent_slot_available;
use crate::commands::settings::DEFAULT_MAX_CONCURRENT_AGENTS;

#[test]
fn agents_below_the_limit_are_allowed() {
    assert!(agent_slot_available(Some(3), 0, false).is_ok());
    assert!(agent_slot_available(Some(3), 2, false).is_ok());
}

#[test]
fn the_agent_at_the_limit_is_refused_with_something_actionable() {
    let err = agent_slot_available(Some(3), 3, false).unwrap_err();
    assert!(err.contains('3'), "the message should name the limit: {err}");
    assert!(err.to_lowercase().contains("settings"), "and where to change it: {err}");
}

/// Reconnecting a thread replaces its connection; refusing that would strand a
/// thread the user already has open once the limit is reached.
#[test]
fn replacing_an_existing_connection_is_always_allowed() {
    assert!(agent_slot_available(Some(1), 1, true).is_ok());
    assert!(agent_slot_available(Some(3), 99, true).is_ok());
}

#[test]
fn zero_means_the_user_opted_out_of_the_limit() {
    assert!(agent_slot_available(Some(0), 500, false).is_ok());
}

#[test]
fn an_unset_limit_falls_back_to_the_default() {
    let n = DEFAULT_MAX_CONCURRENT_AGENTS as usize;
    assert!(agent_slot_available(None, n - 1, false).is_ok());
    assert!(agent_slot_available(None, n, false).is_err());
}

/// The singular reads correctly, since a limit of one is a plausible setting.
#[test]
fn a_limit_of_one_is_phrased_as_one() {
    let err = agent_slot_available(Some(1), 1, false).unwrap_err();
    assert!(err.starts_with("1 agent is"), "got: {err}");
}

// ── Slot reservation (check-and-claim under one lock) ───────────

use super::commands::reserve_agent_slot;
use super::types::AgentState;

/// Two concurrent task_creates used to both pass the cap check before either
/// inserted its handle. A reservation claims the slot at check time, so the
/// second caller sees the first caller's claim.
#[test]
fn a_reservation_counts_toward_the_limit_until_dropped() {
    let state = AgentState::default();
    let first = reserve_agent_slot(&state, Some(1), "task-a").expect("first slot");
    assert!(
        reserve_agent_slot(&state, Some(1), "task-b").is_err(),
        "the reserved (not yet spawned) slot must already count"
    );
    drop(first);
    assert!(
        reserve_agent_slot(&state, Some(1), "task-b").is_ok(),
        "dropping the reservation must release the slot"
    );
}

/// Re-reserving the same id is a replacement, not an addition — the reconnect
/// path must never be refused for the thread it is reconnecting.
#[test]
fn reserving_the_same_id_twice_is_a_replacement() {
    let state = AgentState::default();
    let _first = reserve_agent_slot(&state, Some(1), "task-a").expect("first slot");
    assert!(reserve_agent_slot(&state, Some(1), "task-a").is_ok());
}

// ── Backend timestamp precision ─────────────────────────────────

/// Backend-constructed messages share the SQLite dedupe key with frontend
/// ones; at 1-second precision two identical sends in the same second
/// collapsed into one row. The format must carry milliseconds.
#[test]
fn now_rfc3339_has_millisecond_precision() {
    let ts = super::now_rfc3339();
    // Shape: 2024-01-15T12:30:45.123Z
    assert_eq!(ts.len(), 24, "expected YYYY-MM-DDTHH:MM:SS.mmmZ, got {ts}");
    assert_eq!(&ts[10..11], "T");
    assert_eq!(&ts[19..20], ".");
    assert!(ts.ends_with('Z'));
    assert!(
        ts[20..23].chars().all(|c| c.is_ascii_digit()),
        "fractional part must be three digits: {ts}"
    );
}

// ── Debug-panel mirror gating ───────────────────────────────────

use super::connection::{debug_mirror_payload, DEBUG_MIRROR_MAX_BYTES};

#[test]
fn message_update_deltas_are_not_mirrored() {
    let event = serde_json::json!({
        "type": "message_update",
        "assistantMessageEvent": { "type": "text_delta", "delta": "hi" },
    });
    assert!(debug_mirror_payload("message_update", event).is_none());
}

#[test]
fn small_events_are_mirrored_verbatim() {
    let event = serde_json::json!({ "type": "goal_update", "goal": "ship it" });
    let mirrored = debug_mirror_payload("goal_update", event.clone()).unwrap();
    assert_eq!(mirrored, event);
}

#[test]
fn oversized_payloads_become_a_placeholder_with_size_info() {
    let big = "x".repeat(DEBUG_MIRROR_MAX_BYTES + 1);
    let event = serde_json::json!({ "type": "tool_execution_end", "result": big });
    let mirrored = debug_mirror_payload("tool_execution_end", event).unwrap();
    assert_eq!(mirrored["truncated"], true);
    assert_eq!(mirrored["type"], "tool_execution_end");
    assert!(
        mirrored["originalBytes"].as_u64().unwrap() as usize > DEBUG_MIRROR_MAX_BYTES,
        "the placeholder must record the original size"
    );
}

#[test]
fn error_events_are_mirrored_in_full_even_when_large() {
    let big = "x".repeat(DEBUG_MIRROR_MAX_BYTES + 1);
    let event = serde_json::json!({ "type": "extension_error", "error": big });
    let mirrored = debug_mirror_payload("extension_error", event.clone()).unwrap();
    assert_eq!(mirrored, event, "error detail is exactly what the debug panel is for");
}
