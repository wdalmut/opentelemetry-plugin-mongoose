import "jasmine";

import { MongoosePlugin, plugin } from '../src';
import { AttributeNames } from '../src/enums';
import { NoopLogger } from '@opentelemetry/core';
import { NodeTracerProvider } from '@opentelemetry/node';

import mongoose from 'mongoose';

const logger = new NoopLogger();
const provider = new NodeTracerProvider();
plugin.enable(mongoose, provider, logger);

import User, { IUser } from './user'

import { context } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
  InMemorySpanExporter,
  ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/tracing';

import { assertSpan } from './asserts'

describe("something", () => {
  beforeAll(async (done) => {
    await mongoose.connect("mongodb://localhost:27017", {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      useFindAndModify: false,
    });

    await User.insertMany([
      new User({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com'
      }),
      new User({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.doe@example.com'
      }),
      new User({
        firstName: 'Michael',
        lastName: 'Fox',
        email: 'michael.fox@example.com'
      })
    ])

    User.ensureIndexes(() => {
      done()
    })
  });

  afterAll(async (done) => {
    await User.collection.drop();
    await mongoose.connection.close();

    done()
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

    it('should export a plugin', () => {
      expect(plugin instanceof MongoosePlugin).toBe(true)
    })

    it ("instrumenting save operation", async (done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        const user: IUser = new User({
          firstName: 'Test first name',
          lastName: 'Test last name',
          email: 'test@example.com'
        });

        return user.save()
      }).then((user) => {
        const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

        assertSpan(spans[0])

        expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
        expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('save')

        expect(spans[0].attributes[AttributeNames.DB_MODEL]).toEqual(JSON.stringify(user.toJSON()))

        done()
      })
    })

    it ("instrumenting save operation", async (done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        const user: IUser = new User({
          firstName: 'Test first name',
          lastName: 'Test last name',
          email: 'john.doe@example.com'
        });

        return user.save()
      })
      .then((user) => {
        fail(new Error("should not be possible"))
        done()
      })
      .catch((err) => {
        const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

        assertSpan(spans[0])

        expect(spans[0].attributes[AttributeNames.MONGO_ERROR_CODE]).toEqual(11000)
        expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
        expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('save')

        done()
      })
    })

    it ("instrumenting find operation", async (done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        User.find({id: "_test"})
          .then((users) => {
            const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

            assertSpan(spans[0])
            expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
            expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('find')

            expect(spans[0].attributes[AttributeNames.DB_STATEMENT]).toEqual('{"id":"_test"}')
            expect(spans[0].attributes[AttributeNames.DB_OPTIONS]).toEqual('{}')
            expect(spans[0].attributes[AttributeNames.DB_UPDATE]).toBe(null)

            done()
          })

      })
    })
  })
});
