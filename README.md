# 🎴 Pokemon Target Drop Monitor

Polls Target's internal product API every 25 seconds.
When stock appears, it fires a desktop notification and auto-opens
the product page — which triggers your Tampermonkey ATC script.

## Setup (one time)

1. Install Node.js from https://nodejs.org  (LTS version)
2. Open a terminal / command prompt in this folder
3. Run:  npm install

## Running

```
node monitor.js
```

Leave it running in the background. You'll see a live status line
for each product every 25 seconds. When something goes in stock
you get a desktop popup and the page opens automatically.

Press Ctrl+C to stop.

## Adding products

Open monitor.js and add entries to the `products` array:

```js
{ name: 'Whatever Set', tcin: '12345678' },
```

The TCIN is the number in the Target URL:
  https://www.target.com/p/name/-/A-XXXXXXXX
                                     ^^^^^^^^ this part

## Config options (top of monitor.js)

| Option               | Default | Description                          |
|----------------------|---------|--------------------------------------|
| pollIntervalSeconds  | 25      | How often to check (min 20)          |
| zipCode              | 75067   | Your ZIP for local availability      |
| autoOpenBrowser      | true    | Open browser tab when in stock       |
| sound                | true    | Play sound with desktop notification |
