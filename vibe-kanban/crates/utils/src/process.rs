use command_group::AsyncGroupChild;
#[cfg(unix)]
use tokio::time::Duration;

pub async fn kill_process_group(child: &mut AsyncGroupChild) -> std::io::Result<()> {
    let _ = kill_process_group_confirmed(child).await;
    Ok(())
}

/// Terminate the process group and confirm that its leader has been reaped.
/// Unlike the legacy best-effort helper, any signal or wait ambiguity is returned.
pub async fn kill_process_group_confirmed(child: &mut AsyncGroupChild) -> std::io::Result<()> {
    let mut signal_error: Option<std::io::Error> = None;
    #[cfg(unix)]
    {
        // Use command_group's UnixChildExt::signal() which calls killpg()
        // with the pgid captured at spawn time. This works even after the
        // group leader has exited, unlike getpgid() which would fail.
        use command_group::{Signal, UnixChildExt};

        for sig in [Signal::SIGINT, Signal::SIGTERM, Signal::SIGKILL] {
            tracing::info!("Sending {:?} to process group", sig);
            if let Err(e) = child.signal(sig) {
                // break if the group does not exist anymore
                if e.raw_os_error() == Some(nix::libc::ESRCH) {
                    break;
                }
                tracing::warn!("Failed to send signal {:?} to process group: {}", sig, e);
                signal_error.get_or_insert(e);
            }
            if sig != Signal::SIGKILL {
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    }

    let kill_error = child
        .kill()
        .await
        .err()
        .filter(|error| error.kind() != std::io::ErrorKind::InvalidInput);
    let wait_result = child.wait().await;
    if let Some(error) = signal_error.or(kill_error) {
        return Err(error);
    }
    wait_result.map(|_| ())
}
