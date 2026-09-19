import type { ContentPack } from './content'

/** Учебный контент на русском. Код в листингах не переводится — он читается как написан. */
export const RU: ContentPack = {
  difficulty: { Beginner: 'Начальный', Intermediate: 'Средний', Advanced: 'Продвинутый' , Easy: 'Лёгкая', Medium: 'Средняя', Hard: 'Сложная' },

  levels: {
    Beginner: { name: 'Новичок', blurb: 'Осваивается' },
    Apprentice: { name: 'Ученик', blurb: 'Сдаёт работы регулярно' },
    Practitioner: { name: 'Практик', blurb: 'Работает без напоминаний' },
    Specialist: { name: 'Специалист', blurb: 'Глубина в чём-то конкретном' },
    Master: { name: 'Мастер', blurb: 'Уже может учить сам' },
  },

  achievements: {
    'first-robot': { name: 'Первый робот', description: 'Пройден первый урок', hint: 'Пройди любой урок' },
    'first-project': { name: 'Первый проект', description: 'Первая работа отправлена на проверку', hint: 'Отправь проект' },
    'sensor-master': { name: 'Мастер датчиков', description: 'Пройдено три урока с датчиками', hint: 'Пройди 3 урока о датчиках' },
    'code-explorer': { name: 'Исследователь кода', description: 'Пройдена автоматическая проверка кода', hint: 'Пройди автопроверку в редакторе' },
    'streak-7': { name: 'Серия 7 дней', description: 'Семь дней подряд с робототехникой', hint: 'Держи серию 7 дней' },
    'approved-builder': { name: 'Принятая сборка', description: 'Наставник принял твой проект', hint: 'Добейся принятия проекта' },
    'challenge-hunter': { name: 'Охотник за испытаниями', description: 'Пройдено три испытания', hint: 'Пройди 3 испытания' },
    'module-master': { name: 'Мастер модуля', description: 'Пройдены все уроки модуля', hint: 'Закрой модуль целиком' },
    'competition-ready': { name: 'Готов к соревнованиям', description: 'Ты в команде и на уровне «Инженер»', hint: 'Вступи в команду и дойди до «Инженера»' },
    'mentor-favourite': { name: 'Любимец наставника', description: 'Получено три отзыва наставника', hint: 'Собери 3 отзыва' },
  },

  courses: {},
  modules: {},
  lessons: {},
}
