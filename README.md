# Money Forward → Lunch Money Importer

Syncs financial transactions from Money Forward and Revolut into Lunch Money.

## Overview

This tool automates the process of importing transactions from multiple sources into Lunch Money:

- **Money Forward**: Scrapes transaction data using Playwright
- **Revolut**: Imports transactions from CSV exports. This is manual at the moment and needs the statements downloaded from the Revolut website in Excel (CSV) format.

## Setup

### Prerequisites

- [Bun](https://bun.sh) runtime installed
- Lunch Money account with API key
- Money Forward account
- Revolut CSV exports (optional)

### Installation

```bash
bun install
```

### Configuration

Create `.env` file in `packages/app/`:

```bash
cp packages/app/.env.example packages/app/.env
```

Configure the following variables:

```env
# Lunch Money
LUNCH_MONEY_API_KEY=your_api_key

# Money Forward
MONEY_FORWARD_EMAIL_ADDRESS=your_email
MONEY_FORWARD_AUTH_PASSWORD=your_password
MONEY_FORWARD_OTPAUTH_URI=otpauth://...
```

### Data Directory Setup

Place your financial data in the appropriate directories:

```
packages/app/data/
├── money-forward/    # CSV exports from Money Forward
└── revolut/          # CSV exports from Revolut
```

## Usage

Run the importer:

```bash
bun start
```

The tool will:
1. Prompt to scrape Money Forward
2. Sync accounts from Money Forward and Revolut to Lunch Money
3. Load transactions from CSV files
4. Import transactions in batches of 500
5. Skip duplicates based on external_id
6. Apply Lunch Money rules automatically

## Project Structure

```
packages/
├── app/              # Main application
│   ├── money-forward/
│   │   ├── 3rdparty/    # Playwright scraper
│   │   └── importer.ts  # CSV importer
│   ├── revolut/
│   │   └── importer.ts  # CSV importer with validation
│   ├── accounts.ts      # Account sync logic
│   ├── index.ts         # Main entry point
│   └── setup.ts         # Configuration and initialization
└── logger/           # Logging utilities

```

## Features

- **Transaction validation**: Validates CSV data against expected formats with detailed error reporting
- **Duplicate detection**: Uses external_id hash to prevent duplicate imports
- **Batch processing**: Imports transactions in configurable batches (default: 500)
- **Account syncing**: Automatically creates/updates accounts in Lunch Money
- **State persistence**: Maintains authentication state for Money Forward scraping
- **Transaction filtering**: Only imports completed Revolut transactions

## Development

Lint and format code:

```bash
bun run lint
```

The project uses:
- Bun workspaces for monorepo management
- TypeScript for type safety
- Biome for linting and formatting
- Playwright for web scraping
- SQLite for local state persistence

## Attribution

The Money Forward scraping implementation is based on [hiroppy/mf-dashboard](https://github.com/hiroppy/mf-dashboard).
