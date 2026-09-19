import type { ContentPack } from './content'

/** Оқу мазмұны қазақ тілінде. Код листингтері аударылмайды — жазылғандай оқылады. */
export const KK: ContentPack = {
  difficulty: { Beginner: 'Бастауыш', Intermediate: 'Орта', Advanced: 'Жоғары' , Easy: 'Оңай', Medium: 'Орташа', Hard: 'Қиын' },

  levels: {
    Beginner: { name: 'Бастаушы', blurb: 'Бағдарлап жүр' },
    Apprentice: { name: 'Шәкірт', blurb: 'Жұмысын тұрақты тапсырады' },
    Practitioner: { name: 'Тәжірибелі', blurb: 'Еске салмай-ақ істейді' },
    Specialist: { name: 'Маман', blurb: 'Нақты бір салада тереңдік' },
    Master: { name: 'Шебер', blurb: 'Өзі үйрете алады' },
  },

  achievements: {
    'first-robot': { name: 'Алғашқы робот', description: 'Алғашқы сабақ аяқталды', hint: 'Кез келген сабақты аяқта' },
    'first-project': { name: 'Алғашқы жоба', description: 'Алғашқы жұмыс тексеруге жіберілді', hint: 'Жоба жібер' },
    'sensor-master': { name: 'Сенсор шебері', description: 'Сенсорлы үш сабақ аяқталды', hint: 'Сенсор туралы 3 сабақты аяқта' },
    'code-explorer': { name: 'Код зерттеушісі', description: 'Автоматты код тексерісі өтті', hint: 'Редактордағы автотексерістен өт' },
    'streak-7': { name: '7 күндік серия', description: 'Қатарынан жеті күн робототехника', hint: '7 күндік серияны ұста' },
    'approved-builder': { name: 'Мақұлданған құрастыру', description: 'Тәлімгер жобаңды мақұлдады', hint: 'Жобаңды мақұлдат' },
    'challenge-hunter': { name: 'Сынақ аңшысы', description: 'Үш сынақ орындалды', hint: '3 сынақты орында' },
    'module-master': { name: 'Модуль шебері', description: 'Модульдің барлық сабағы аяқталды', hint: 'Модульді толық аяқта' },
    'competition-ready': { name: 'Жарысқа дайын', description: 'Командадасың әрі «Инженер» деңгейіндесің', hint: 'Командаға қосыл және «Инженерге» жет' },
    'mentor-favourite': { name: 'Тәлімгер таңдауы', description: 'Тәлімгерден үш пікір жиналды', hint: '3 пікір жина' },
  },

  courses: {},
  modules: {},
  lessons: {},
}
