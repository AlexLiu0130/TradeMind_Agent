# Serenity Archive Import Design

## Goal

Build `/intel` into a Chinese Serenity archive. The user exports browser data from X and uploads it; the app imports every detected post into SQLite, keeps captures append-only, extracts tickers, and shows ticker performance plus Chinese sector labels.

## Data Model

Keep `intel_items` as the source of truth and add `external_id` for X post IDs. No unique constraint is added because repeated imports must not delete or overwrite prior captures. `raw_payload` stores the original extracted post data and import metadata.

## Import Flow

The dashboard accepts `.har`, `.json`, and `.txt` uploads. JSON and HAR files are parsed recursively for tweet-like objects with text fields such as `full_text`, `rawContent`, or `legacy.full_text`. Plain text is split into post-sized blocks. Each extracted item is inserted as a separate `intel_items` row with `capture_method = "browser-import"`.

## UI

The page uses the existing terminal instrument visual language, but all product labels and analysis copy are Chinese except tickers. The main column is a time-sorted archive feed ordered by `item_ts` descending, falling back to capture time. The right rail aggregates related tickers and displays portfolio overlap, Chinese sector/sub-industry, baseline/current price, and performance since the post baseline.

## Browser Export Guide

Add an in-app guide describing how to export X data from the browser:

1. Open Serenity's X profile or search results in Chrome.
2. Open DevTools, choose Network, enable Preserve log, and refresh/scroll.
3. Right-click a network request list entry and export all as HAR.
4. Upload the `.har` file in `/intel`.

The guide is honest about limitations: X can change its internal response shape, private content requires the user's logged-in browser session, and the app stores what the user uploads rather than bypassing X login.

## Testing

Add a small Node test for import parsing and a Python storage test for `external_id`. Keep the existing Python, TypeScript, lint, build, and browser checks.
