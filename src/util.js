import {ms} from 'space-time';

export {ms} from 'space-time';

export const {assign, defineProperties} = Object;

export const sleep = time => new Promise(resolve => setTimeout(resolve, ms(time)));

export const countOf = (it, subject='item') => {

    const count = Array.isArray(it)
        ? it.length
        : it;

    const plural = count === 1
        ? ''
        : 's';

    return `${count} ${subject}${plural}`;
};

export const checkType = (it, constructor) => {
    if (! (it instanceof constructor)) {
        throw new TypeError(`Expected instance of ${constructor.name}`);
    }
};
