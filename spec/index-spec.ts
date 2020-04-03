import "jasmine";

import { plugin } from '../src';
import { NoopLogger } from '@opentelemetry/core';
import { NodeTracerProvider } from '@opentelemetry/node';

import mongoose from 'mongoose';

const logger = new NoopLogger();
const provider = new NodeTracerProvider();
plugin.enable(mongoose, provider, logger);

import User, { IUser } from './user'

import { CanonicalCode, context, SpanKind } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
  InMemorySpanExporter,
  ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/tracing';

describe("something", () => {
  beforeAll(async () => {
    await mongoose.connect("mongodb://localhost:27017", {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      useFindAndModify: false,
      autoIndex: false,
    });
  });

  afterAll(async () => {
    await User.collection.drop();
    await mongoose.connection.close();
  });

  describe("Trace", () => {
    let contextManager: AsyncHooksContextManager;
    const memoryExporter = new InMemorySpanExporter();
    const spanProcessor = new SimpleSpanProcessor(memoryExporter);
    provider.addSpanProcessor(spanProcessor);

    beforeEach(() => {

      memoryExporter.reset();
      contextManager = new AsyncHooksContextManager().enable();
      context.setGlobalContextManager(contextManager);
    })

    afterEach(() => {
      contextManager.disable();
    });

    it ("instrumenting save operation", async (done) => {
      const span = provider.getTracer('default').startSpan(`insertRootSpan`);
      provider.getTracer('default').withSpan(span, async () => {
        const user: IUser = new User({
          firstName: 'Test first name',
          lastName: 'Test last name',
          email: 'test@example.com'
        });

        await user.save()
        span.end();

        done()
      })
    })

    it ("instrumenting find operation", async (done) => {
      const span = provider.getTracer('default').startSpan(`insertRootSpan`);
      provider.getTracer('default').withSpan(span, async () => {
        await User.find({id: "_test"})

        span.end();

        done()
      })
    })
  })
});
