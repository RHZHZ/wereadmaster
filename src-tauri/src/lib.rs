mod commands;
mod config;
mod db;
mod errors;
mod export;
mod mappers;
mod repositories;
mod services;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = crate::db::default_data_dir(app.handle())
                .expect("failed to resolve local app data directory");
            std::fs::create_dir_all(&data_dir).expect("failed to create local app data directory");
            crate::db::open_connection(app.handle())
                .expect("failed to initialize local reading database");
            let salt_path = data_dir.join("stronghold-salt.txt");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;

            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::ai::get_ai_settings_state,
            commands::ai::validate_ai_credential,
            commands::ai::save_ai_credential,
            commands::ai::save_ai_settings,
            commands::ai::test_ai_connection,
            commands::ai::remove_ai_credential,
            commands::ai::get_ai_cached_output,
            commands::ai::summarize_book_notes,
            commands::ai::get_latest_book_notes_summary,
            commands::ai::export_book_notes_summary_markdown,
            commands::ai::export_book_notes_summaries_markdown,
            commands::ai::list_book_notes_summaries,
            commands::ai::list_ai_asset_summaries,
            commands::ai::get_ai_asset_detail,
            commands::ai::get_ai_asset_version_detail,
            commands::ai::get_ai_asset_version_history,
            commands::ai::get_ai_review_feedback,
            commands::ai::save_ai_review_feedback,
            commands::ai::summarize_reading_stats,
            commands::ai::get_latest_reading_stats_review,
            commands::ai::export_reading_stats_review_markdown,
            commands::ai::summarize_reading_route,
            commands::ai::get_latest_reading_route,
            commands::ai::export_reading_route_markdown,
            commands::ai::summarize_book_decision,
            commands::ai::get_latest_book_decision,
            commands::ai::export_book_decision_markdown,
            commands::credentials::get_credential_status,
            commands::credentials::validate_credential,
            commands::credentials::save_credential,
            commands::credentials::remove_credential,
            commands::shelf::sync_shelf,
            commands::shelf::get_bookshelf,
            commands::book::get_book_detail,
            commands::book::open_book_in_weread,
            commands::notes::get_notebook_overview,
            commands::notes::get_book_notes,
            commands::notes::export_book_notes_markdown,
            commands::notes::preflight_bulk_export,
            commands::notes::export_bulk_notes,
            commands::notes::cancel_bulk_export,
            commands::stats::sync_reading_stats,
            commands::stats::get_reading_stats,
            commands::discovery::search_books,
            commands::discovery::get_recommendations,
            commands::discovery::get_similar_books,
            commands::discovery::get_public_reviews,
            commands::reading_state::list_reading_item_states,
            commands::reading_state::get_reading_item_state,
            commands::reading_state::upsert_reading_item_state,
            commands::reading_state::remove_reading_item_state,
            commands::settings::get_settings_state,
            commands::settings::clear_local_cache,
            commands::settings::clear_ai_output_cache,
            commands::settings::export_diagnostics,
            commands::settings::export_local_data_backup,
            commands::settings::restore_local_data_backup,
            commands::settings::choose_custom_data_directory,
            commands::settings::migrate_local_data_directory,
            commands::settings::choose_custom_export_directory,
            commands::settings::save_custom_export_directory,
            commands::settings::reset_custom_export_directory
        ])
        .run(tauri::generate_context!())
        .expect("failed to run personal reading app");
}
