# External URL Submission Specification

## ADDED Requirements

### Requirement: External URL Batch Submission
The system SHALL provide an API endpoint for users to submit external URLs directly to IndexNow without requiring sitemap crawling.

#### Scenario: Successful batch URL submission
- **GIVEN** a valid site configuration exists
- **WHEN** user sends POST request to `/api/urls/submit` with a JSON body containing `urls` array
- **THEN** the system SHALL validate each URL format
- **AND** filter out previously submitted URLs (using existing URL cache)
- **AND** submit new URLs to IndexNow API
- **AND** return a response with submission statistics

#### Scenario: Site-specific URL submission
- **GIVEN** a site with id `example-site` is configured
- **WHEN** user sends POST request to `/api/urls/submit/example-site` with URLs
- **THEN** the system SHALL use the site's IndexNow API key
- **AND** record submission history under that site's records

#### Scenario: Empty URL array submission
- **WHEN** user sends POST request with an empty `urls` array
- **THEN** the system SHALL return a 400 Bad Request error
- **AND** the response SHALL contain error message "No URLs provided"

### Requirement: URL Format Validation
The system SHALL validate all submitted URLs before processing.

#### Scenario: Valid URL accepted
- **WHEN** a URL with valid HTTP/HTTPS scheme and domain is submitted
- **THEN** the system SHALL accept the URL for processing

#### Scenario: Invalid URL rejected
- **WHEN** a URL with invalid format (missing scheme, invalid domain, or malformed path) is submitted
- **THEN** the system SHALL reject the URL
- **AND** include it in the response's `invalid` array with reason

#### Scenario: Duplicate URL filtered
- **WHEN** a URL that was previously submitted within the cache TTL period is included
- **THEN** the system SHALL skip the URL
- **AND** include it in the response's `skipped` array

### Requirement: Rate Limiting
The system SHALL implement rate limiting to prevent API abuse.

#### Scenario: Within rate limit
- **WHEN** requests are within the configured rate limit (default: 10 requests per minute per IP)
- **THEN** the system SHALL process the request normally

#### Scenario: Rate limit exceeded
- **WHEN** a client exceeds the rate limit
- **THEN** the system SHALL return a 429 Too Many Requests response
- **AND** include `Retry-After` header indicating when the client can retry

### Requirement: Batch Size Limit
The system SHALL enforce a maximum batch size per request.

#### Scenario: Batch within limit
- **WHEN** a request contains up to 1000 URLs
- **THEN** the system SHALL process all URLs

#### Scenario: Batch exceeds limit
- **WHEN** a request contains more than 1000 URLs
- **THEN** the system SHALL return a 400 Bad Request error
- **AND** the response SHALL indicate the maximum allowed batch size

### Requirement: Submission History Tracking
The system SHALL maintain a history of external URL submissions.

#### Scenario: History recorded
- **WHEN** a batch submission completes (success or partial success)
- **THEN** the system SHALL record the submission in KV storage
- **AND** the record SHALL include timestamp, URL count, success/failure counts, and source identifier

#### Scenario: History query
- **WHEN** user sends GET request to `/api/urls/history`
- **THEN** the system SHALL return the last 100 submission records
- **AND** support optional `site` query parameter for site-specific history

### Requirement: Response Format
The system SHALL return structured JSON responses for all submission operations.

#### Scenario: Successful response structure
- **WHEN** a submission request completes
- **THEN** the response SHALL include:
  - `success`: boolean indicating overall success
  - `submitted`: number of URLs successfully submitted
  - `skipped`: number of URLs skipped (duplicates)
  - `invalid`: array of invalid URLs with reasons
  - `failed`: number of URLs that failed submission
  - `timestamp`: ISO 8601 timestamp of the operation
