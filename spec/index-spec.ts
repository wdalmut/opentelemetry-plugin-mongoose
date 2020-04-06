import "jasmine";

import { MongoosePlugin, plugin } from '../src';
import { AttributeNames } from '../src/enums';
import { NoopLogger } from '@opentelemetry/core';
import { NodeTracerProvider } from '@opentelemetry/node';
import { CanonicalCode } from '@opentelemetry/api';

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

describe("mongoose opentelemetry plugin", () => {
  beforeAll(async (done) => {
    await mongoose.connect("mongodb://localhost:27017", {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      useFindAndModify: false,
    });
    done()
  });

  afterAll(async (done) => {
    await mongoose.connection.close();
    done()
  });


  beforeEach(async (done) => {
    await User.insertMany([
      new User({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        age: 18,
      }),
      new User({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.doe@example.com',
        age: 19,
      }),
      new User({
        firstName: 'Michael',
        lastName: 'Fox',
        email: 'michael.fox@example.com',
        age: 16,
      })
    ])

    User.createIndexes(() => {
      done()
    })
  })

  afterEach(async () => {
    await User.collection.drop();
  })

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

    it("instrumenting save operation", async (done) => {
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

        expect(spans.length).toBe(1)
        assertSpan(spans[0])

        expect(spans[0].status.code).toEqual(CanonicalCode.OK)

        expect(spans[0].attributes[AttributeNames.DB_STATEMENT]).toMatch('')
        expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
        expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('save')

        done()
      })
    })

    it("instrumenting error on save operation", async (done) => {
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

        expect(spans[0].status.code).toEqual(CanonicalCode.UNKNOWN)

        expect(spans[0].attributes[AttributeNames.DB_STATEMENT]).toMatch('')
        expect(spans[0].attributes[AttributeNames.MONGO_ERROR_CODE]).toEqual(11000)
        expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
        expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('save')

        done()
      })
    })

    it("instrumenting find operation", async (done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        User.find({id: "_test"})
          .then((users) => {
            const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

            assertSpan(spans[0])
            expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
            expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('find')

            expect(spans[0].attributes[AttributeNames.DB_STATEMENT]).toEqual('{"id":"_test"}')

            done()
          })
      })
    })

    it("instrumenting multiple find operations", async (done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        Promise.all([User.find({id: "_test1"}), User.find({id: "_test2"})])
          .then((users) => {
            const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

            expect(spans.length).toBe(2)

            assertSpan(spans[0])
            expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
            expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('find')

            expect(spans[0].attributes[AttributeNames.DB_STATEMENT]).toMatch(/^{"id":"_test[1-2]"}$/g)

            assertSpan(spans[1])
            expect(spans[1].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
            expect(spans[1].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('find')

            expect(spans[1].attributes[AttributeNames.DB_STATEMENT]).toMatch(/^{"id":"_test[1-2]"}$/g)

            done()
          })
      })
    })

    it("instrumenting find operation with chaining structures", async (done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        User
          .find({id: "_test"})
          .skip(1)
          .limit(2)
          .sort({email: 'asc'})
          .then((users) => {
            const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

            assertSpan(spans[0])
            expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
            expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('find')

            expect(spans[0].attributes[AttributeNames.DB_STATEMENT]).toEqual('{"id":"_test"}')

            done()
          })
      })
    })

    it('instrumenting remove operation [deprecated]', async(done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        User.findOne({email: 'john.doe@example.com'})
          .then(user => user!.remove())
          .then(user => {
            const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

            expect(spans[1].attributes[AttributeNames.DB_STATEMENT]).toMatch('')
            expect(spans[1].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
            expect(spans[1].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('remove')

            done()
          })
      })
    })

    it('instrumenting deleteOne operation', async(done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        User.deleteOne({email: 'john.doe@example.com'})
          .then(op => {
            expect(op.deletedCount).toBe(1)
            const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

            expect(spans.length).toBe(1)

            expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
            expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('deleteOne')

            expect(spans[0].attributes[AttributeNames.DB_STATEMENT]).toEqual('{"email":"john.doe@example.com"}')
            expect(spans[0].attributes[AttributeNames.DB_OPTIONS]).toEqual('{}')
            expect(spans[0].attributes[AttributeNames.DB_UPDATE]).toBe(undefined)
            done()
          })
      })
    })

    it('instrumenting updateOne operation on models', async(done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        User.findOne({ email: 'john.doe@example.com' })
          .then(user => user!.updateOne({ $inc: {age: 1} }, { w: 1 }))
          .then(user => {
            const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

            expect(spans[1].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
            expect(spans[1].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('updateOne')

            expect(spans[1].attributes[AttributeNames.DB_STATEMENT]).toMatch(/{"_id":"\w+"}/)
            expect(spans[1].attributes[AttributeNames.DB_OPTIONS]).toEqual('{"w":1}')
            expect(spans[1].attributes[AttributeNames.DB_UPDATE]).toEqual('{"$inc":{"age":1}}')
            done()
          })
      })
    })

    it('instrumenting updateOne operation', async(done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        User.updateOne({ email: 'john.doe@example.com' }, { $inc: {age: 1} })
          .then(user => {
            const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

            expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
            expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('updateOne')

            expect(spans[0].attributes[AttributeNames.DB_STATEMENT]).toEqual('{"email":"john.doe@example.com"}')
            expect(spans[0].attributes[AttributeNames.DB_OPTIONS]).toEqual('{}')
            expect(spans[0].attributes[AttributeNames.DB_UPDATE]).toEqual('{"$inc":{"age":1}}')
            done()
          })
      })
    })

    it('instrumenting deleteOne operation', async(done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        User.deleteOne({ email: 'john.doe@example.com' })
          .then(user => {
            const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

            expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
            expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('deleteOne')

            expect(spans[0].attributes[AttributeNames.DB_STATEMENT]).toEqual('{"email":"john.doe@example.com"}')
            expect(spans[0].attributes[AttributeNames.DB_OPTIONS]).toEqual('{}')
            expect(spans[0].attributes[AttributeNames.DB_UPDATE]).toEqual(undefined)
            done()
          })
      })
    })

    it('instrumenting count operation [deprecated]', async(done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        User.count({})
          .then(users => {
            const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

            expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
            expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('count')

            expect(spans[0].attributes[AttributeNames.DB_STATEMENT]).toEqual('{}')
            expect(spans[0].attributes[AttributeNames.DB_OPTIONS]).toEqual('{}')
            expect(spans[0].attributes[AttributeNames.DB_UPDATE]).toEqual(undefined)
            done()
          })
      })
    })

    it('instrumenting countDocuments operation', async(done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        User.countDocuments({})
          .then(users => {
            const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

            expect(spans.length).toBe(1)

            expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
            expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('countDocuments')

            expect(spans[0].attributes[AttributeNames.DB_STATEMENT]).toEqual('{}')
            expect(spans[0].attributes[AttributeNames.DB_OPTIONS]).toEqual('{}')
            expect(spans[0].attributes[AttributeNames.DB_UPDATE]).toEqual(undefined)
            done()
          })
      })
    })

    it('instrumenting estimatedDocumentCount operation', async(done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        User.estimatedDocumentCount({})
          .then(users => {
            const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

            expect(spans.length).toBe(1)

            expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
            expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('estimatedDocumentCount')

            expect(spans[0].attributes[AttributeNames.DB_STATEMENT]).toEqual('{}')
            expect(spans[0].attributes[AttributeNames.DB_OPTIONS]).toEqual('{}')
            expect(spans[0].attributes[AttributeNames.DB_UPDATE]).toEqual(undefined)
            done()
          })
      })
    })

    it('instrumenting deleteMany operation', async(done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        User.deleteMany({})
          .then(users => {
            const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

            expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
            expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('deleteMany')

            expect(spans[0].attributes[AttributeNames.DB_STATEMENT]).toEqual('{}')
            expect(spans[0].attributes[AttributeNames.DB_OPTIONS]).toEqual('{}')
            expect(spans[0].attributes[AttributeNames.DB_UPDATE]).toEqual(undefined)
            done()
          })
      })
    })

    it('instrumenting findOne operation', async(done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        User.findOne({ email: 'john.doe@example.com' })
          .then(user => {
            const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

            expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
            expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('findOne')


            expect(spans[0].attributes[AttributeNames.DB_STATEMENT]).toMatch('{"email":"john.doe@example.com"}')
            expect(spans[0].attributes[AttributeNames.DB_OPTIONS]).toEqual('{}')
            expect(spans[0].attributes[AttributeNames.DB_UPDATE]).toEqual(undefined)
            done()
          })
      })
    })

    it('instrumenting update operation', async(done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        User.update({ email: 'john.doe@example.com' }, { email: 'john.doe2@example.com' })
          .then(user => {
            const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

            expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
            expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('update')


            expect(spans[0].attributes[AttributeNames.DB_STATEMENT]).toEqual('{"email":"john.doe@example.com"}')
            expect(spans[0].attributes[AttributeNames.DB_OPTIONS]).toEqual('{}')
            expect(spans[0].attributes[AttributeNames.DB_UPDATE]).toEqual('{"email":"john.doe2@example.com"}')
            done()
          })
      })
    })

    it('instrumenting updateMany operation', async(done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        User.updateMany({ age: 18}, { isDeleted: true })
          .then(user => {
            const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

            expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
            expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('updateMany')


            expect(spans[0].attributes[AttributeNames.DB_STATEMENT]).toEqual('{"age":18}')
            expect(spans[0].attributes[AttributeNames.DB_OPTIONS]).toEqual('{}')
            expect(spans[0].attributes[AttributeNames.DB_UPDATE]).toEqual('{"isDeleted":true}')
            done()
          })
      })
    });

    it(`instrumenting findOneAndDelete operation`, async(done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        User.findOneAndDelete({ email: "john.doe@example.com" })
          .then(() => {
            const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

            expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
            expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('findOneAndDelete')


            expect(spans[0].attributes[AttributeNames.DB_STATEMENT]).toEqual('{"email":"john.doe@example.com"}')
            expect(spans[0].attributes[AttributeNames.DB_OPTIONS]).toEqual('{}')
            expect(spans[0].attributes[AttributeNames.DB_UPDATE]).toEqual(undefined)
            done()
          })
      })
    })

    /**
     * With the current strategy (usign pre-post hooks) it is impossible to
     * create a valid instrumenting library
     */
    it(`instrumenting findOneAndUpdate operation`, async(done) => {
      const span = provider.getTracer('default').startSpan('test span');
      provider.getTracer('default').withSpan(span, () => {
        User.findOneAndUpdate({ email: "john.doe@example.com" }, { isUpdated: true } )
          .then(() => {
            const spans: ReadableSpan[] = memoryExporter.getFinishedSpans();

            expect(spans[0].attributes[AttributeNames.DB_MODEL_NAME]).toEqual('User')
            expect(spans[0].attributes[AttributeNames.DB_QUERY_TYPE]).toEqual('findOneAndUpdate')


            expect(spans[0].attributes[AttributeNames.DB_STATEMENT]).toEqual('{"email":"john.doe@example.com"}')
            expect(spans[0].attributes[AttributeNames.DB_OPTIONS]).toEqual('{}')
            expect(spans[0].attributes[AttributeNames.DB_UPDATE]).toEqual('{"isUpdated":true}')

            done()
          })
      })
    })
  })
});
