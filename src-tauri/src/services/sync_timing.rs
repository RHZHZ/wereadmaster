pub(crate) async fn with_sync_timing<T>(
    label: &str,
    operation: impl std::future::Future<Output = T>,
) -> T {
    let started_at = std::time::Instant::now();
    let result = operation.await;
    println!("[sync] {label}: {}ms", started_at.elapsed().as_millis());
    result
}
