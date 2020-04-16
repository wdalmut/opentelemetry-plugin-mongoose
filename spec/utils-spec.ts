import { safeStringify } from '../src/utils';

describe('utils', () => {
    describe('safeStringify', () => {
        it('Stringify as expected', () => {
            const stringified = safeStringify({ hello: 'world'});
            expect(stringified).toBe('{"hello":"world"}')
        })

        it('Fails to stringify a circular object and returns null', () => {
            const obj: any = { a: 1 };
            obj.b = obj;
            const stringified = safeStringify(obj);

            expect(stringified).toBe(null)
        })
    })
})