import { FaGithub } from 'react-icons/fa';

const team = [
  { name: 'Shozaib Khan', github: 'https://github.com/shozaibkhan' },
  { name: 'Soumya Banerjee', github: 'https://github.com/banerjeesoumya' },
  { name: 'Shivangi Srivastava', github: 'https://github.com/shivangisrivastava' },
  { name: 'Prarabdh Atrey', github: 'https://github.com/prarabdhatrey' },
];

export default function Footer() {
  return (
    <footer className="w-full mt-12 border-t border-border bg-background/90 py-8 px-4 flex flex-col items-center gap-4 text-center">
      <div className="flex flex-wrap justify-center gap-6 mb-2">
        {team.map(member => (
          <a
            key={member.name}
            href={member.github}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors text-base font-medium"
          >
            <FaGithub className="w-5 h-5" />
            <span>{member.name}</span>
          </a>
        ))}
      </div>
      <div className="text-sm text-muted-foreground mb-1">
        Made with <span className="text-red-500">♥</span> by the EquiHealth Team
      </div>
      <div className="text-xs text-muted-foreground">
        &copy; {new Date().getFullYear()} EquiHealth. All rights reserved.
      </div>
    </footer>
  );
} 