use super::*;

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
        tool_calls: Some(vec![
            ToolCallData {
                tool_call_id: "tc-1".to_string(),
                title: "edit file".to_string(),
                status: "in_progress".to_string(),
                kind: None, locations: None, content: None, raw_input: None, raw_output: None,
            },
            ToolCallData {
                tool_call_id: "tc-2".to_string(),
                title: "read file".to_string(),
                status: "pending".to_string(),
                kind: None, locations: None, content: None, raw_input: None, raw_output: None,
            },
            ToolCallData {
                tool_call_id: "tc-3".to_string(),
                title: "shell".to_string(),
                status: "completed".to_string(),
                kind: None, locations: None, content: None, raw_input: None, raw_output: None,
            },
            ToolCallData {
                tool_call_id: "tc-4".to_string(),
                title: "run".to_string(),
                status: "failed".to_string(),
                kind: None, locations: None, content: None, raw_input: None, raw_output: None,
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
