import { Tracer, Attributes } from '@opentelemetry/api'
import { CanonicalCode, Span, SpanKind } from '@opentelemetry/api';
import { MongoError } from 'mongodb'
import { AttributeNames } from './enums';

export function startSpan(tracer: Tracer, name: string, op: string, parentSpan?: Span): Span {
  return tracer.startSpan(`mongoose.${name}.${op}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      [AttributeNames.DB_MODEL_NAME]: name,
      [AttributeNames.DB_TYPE]: 'nosql',
      [AttributeNames.COMPONENT]: 'mongoose',
    },
    parent: parentSpan
  })
}

export function handleExecResponse(execResponse: any, span: Span, enhancedDatabaseReporting?: boolean): any {
  if (!(execResponse instanceof Promise)) {
    span.end()
    return execResponse
  }
  
  return execResponse
    .then(response => {
      if (enhancedDatabaseReporting) {
        span.setAttribute(AttributeNames.DB_RESPONSE, safeStringify(response));
      }
      return response;
    })
    .catch(handleError(span))
    .finally(() => span.end())
}

export function handleError(span: Span) {
  return function(error: MongoError|Error): Promise<MongoError> {
    if (error instanceof MongoError) {
      span.setAttribute(AttributeNames.MONGO_ERROR_CODE, error.code);
    }

    setErrorStatus(span, error)

    return Promise.reject(error)
  }
}

export function setErrorStatus(span: Span, error: MongoError|Error): Span {
  if (error instanceof MongoError) {
    span.setAttribute(AttributeNames.MONGO_ERROR_CODE, error.code);
  }

  span.setStatus({
    code: CanonicalCode.UNKNOWN,
    message: error.message,
  });

  return span
}

export function safeStringify(payload: any): string | null {
  try {
    return JSON.stringify(payload);
  } catch {
    return null;
  }
}

export function getAttributesFromCollection(collection: any): Attributes {
  return {
    [AttributeNames.COLLECTION_NAME]: collection.name,
    [AttributeNames.DB_NAME]: collection.conn.name,
    [AttributeNames.DB_HOST]: collection.conn.host,
    [AttributeNames.DB_PORT]: collection.conn.port,
    [AttributeNames.DB_USER]: collection.conn.user,
  };
}
