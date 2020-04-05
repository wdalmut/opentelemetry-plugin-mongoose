import { ReadableSpan } from '@opentelemetry/tracing';
import { AttributeNames } from '../src/enums';

export function assertSpan(span: ReadableSpan) {
  expect(span.attributes[AttributeNames.COMPONENT]).toEqual('mongoose')
  expect(span.attributes[AttributeNames.DB_TYPE]).toEqual('nosql')
}
