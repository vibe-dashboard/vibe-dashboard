use command_group::AsyncGroupChild;
use services::services::container::ContainerError;

pub(crate) async fn kill_process_group(child: &mut AsyncGroupChild) -> Result<(), ContainerError> {
    utils::process::kill_process_group(child)
        .await
        .map_err(ContainerError::KillFailed)
}

pub(crate) async fn kill_process_group_confirmed(
    child: &mut AsyncGroupChild,
) -> Result<(), ContainerError> {
    utils::process::kill_process_group_confirmed(child)
        .await
        .map_err(ContainerError::KillFailed)
}
