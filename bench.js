import http from 'k6/http';
import { check, fail } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://localhost:8080';
const EMAIL = __ENV.EMAIL;
const PASSWORD = __ENV.PASSWORD;

const cartLatency = new Trend('cart_latency', true);
const cartErrors = new Rate('cart_errors');

export const options = {
  noCookiesReset: true,          // 关键：不要每轮清 cookie，否则 session 丢失
  scenarios: {
    cart_read: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 50 },
        { duration: '60s', target: 200 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: { cart_errors: ['rate<0.01'] },
};

let loggedIn = false;

export default function () {
  if (!loggedIn) {
    const res = http.post(`${BASE}/login`,
      { username: EMAIL, password: PASSWORD },
      { tags: { name: 'login' } });
    if (res.status !== 200) {
      fail(`login failed: status=${res.status}`);
    }
    loggedIn = true;
  }
  const res = http.get(`${BASE}/cart`, { tags: { name: 'cart' } });
  const ok = check(res, { 'cart 200': (r) => r.status === 200 });
  cartErrors.add(!ok);
  cartLatency.add(res.timings.duration);
}
