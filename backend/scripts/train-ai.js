import 'dotenv/config';
import { trainModel, modelCard } from '../src/services/ai-model.js';
import { closePool } from '../src/db.js';

async function run() {
  const model = await trainModel({ persist: true });
  const card = modelCard(model);
  console.log('\nMô hình:', card.version);
  console.log('Thuật toán:', card.algorithm);
  console.log('Mẫu huấn luyện:', card.sample_size, 'dự án đã kết thúc');
  console.log('Tỷ lệ thành công lịch sử:', card.positive_rate, '%');
  console.log('Chỉ số kiểm định chéo:', JSON.stringify(card.metrics));
  console.log('\nHệ số tín hiệu:');
  for (const f of card.features) {
    console.log(`  ${f.coefficient >= 0 ? '+' : ''}${f.coefficient.toFixed(4)}  ${f.label}`);
  }
  console.log('');
}

run()
  .catch((err) => {
    console.error('Huấn luyện thất bại:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => {});
  });
