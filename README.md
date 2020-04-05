# OpenTelemetry Mongoose Plugin

Just a mongoose plugin for opentelemetry

## Installation

```sh
npm install --save @wdalmut/opentelemetry-plugin-mongoose
```

## Usage

```js
const provider = new NodeTracerProvider({
  plugins: {
    mongoose: {
      enabled: true,
      path: '@wdalmut/opentelemetry-plugin-mongoose',
    },
  }
});
```

## Status

This project is in alpha state. Do not use in production if your are not sure
about what are you doing...
