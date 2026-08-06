//! Manual check: generate the wrapper and prove the profile confines Python.
fn main() {
    let ws = std::env::args().nth(1).expect("usage: kernel_sandbox_check <workspace>");
    match laf_agent_lib::commands::kernel_sandbox::wrapper_for(&ws) {
        Ok(Some(p)) => println!("{}", p.display()),
        Ok(None) => { eprintln!("unavailable"); std::process::exit(2); }
        Err(e) => { eprintln!("error: {e}"); std::process::exit(1); }
    }
}
